import asyncio
import time
from datetime import datetime, timezone
from typing import Literal

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import verify_hmac, verify_user
from db import ingestion as db_ingestion
from db import media_assets as db_media
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline import extract, scrape, upload

log = structlog.get_logger()

router = APIRouter()

RATE_PER_MINUTE = 2
RATE_PER_DAY = 50


class IngestRequest(BaseModel):
    source_type: Literal["url", "text"]
    source_url: str | None = None
    source_text: str | None = None


class MediaItem(BaseModel):
    cloudinary_url: str
    cloudinary_id: str
    resource_type: str
    format: str | None
    bytes: int | None
    width: int | None
    height: int | None


class IngestResponse(BaseModel):
    job_id: str
    extracted_title: str
    extracted_text: str
    media: list[MediaItem]
    status: str = "done"


class IngestionJobResponse(BaseModel):
    """Full job row + media, for the polling endpoint."""

    job: dict
    media: list[dict]


def _ms() -> int:
    return int(time.monotonic() * 1000)


async def _run_url_ingestion(
    token: str,
    job_id: str,
    workspace_id: str,
    source_url: str,
) -> None:
    """Background task: scrape, extract, upload, and update the job row.

    Runs outside the original request lifecycle so the client gets an
    immediate response.  Errors are recorded on the job row (stage=failed)
    rather than surfaced as HTTP exceptions.
    """
    bound = log.bind(job_id=job_id, workspace_id=workspace_id, source_url=source_url)

    # Build a fresh RLS client for the background context.
    client = await rls_client(token)

    await db_ingestion.update_job(client, job_id, {"stage": "scraping"})

    t0 = _ms()
    try:
        html = await scrape.fetch_html(source_url)
    except scrape.ScrapeError as exc:
        bound.warning(
            "ingest_scrape_failed",
            url=source_url,
            error=str(exc),
            duration_ms=_ms() - t0,
        )
        await db_ingestion.update_job(
            client, job_id, {"stage": "failed", "error": str(exc)}
        )
        return
    t1 = _ms()

    extracted = extract.parse(html, base_url=source_url)
    t2 = _ms()

    media = await upload.to_cloudinary(extracted.media_urls, workspace_id)
    t3 = _ms()

    await db_ingestion.update_job(
        client,
        job_id,
        {
            "extracted_title": extracted.title,
            "extracted_text": extracted.text,
            "stage": "done",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await db_media.create_media_assets(client, workspace_id, job_id, media)

    bound.info(
        "ingest_done",
        url=source_url,
        title_len=len(extracted.title),
        text_len=len(extracted.text),
        media_count=len(media),
        scrape_ms=t1 - t0,
        extract_ms=t2 - t1,
        upload_ms=t3 - t2,
        total_ms=t3 - t0,
    )


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request) -> IngestResponse:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    # Input validation (mirrors the old Zod schema in web).
    if req.source_type == "text":
        if not req.source_text:
            raise HTTPException(status_code=400, detail="source_text required")
    else:
        if not req.source_url:
            raise HTTPException(status_code=400, detail="source_url required")
        if "linkedin.com" in req.source_url:
            raise HTTPException(
                status_code=422,
                detail="LinkedIn URLs cannot be ingested automatically. Please paste the post text directly.",
            )

    # Rate limiting, scoped to the workspace.
    if await db_ingestion.count_recent_jobs(client, workspace_id, 60) >= RATE_PER_MINUTE:
        raise HTTPException(
            status_code=429, detail="Rate limit: 2 ingestions per minute."
        )
    if await db_ingestion.count_recent_jobs(client, workspace_id, 86400) >= RATE_PER_DAY:
        raise HTTPException(
            status_code=429, detail="Daily ingestion limit reached (50/day)."
        )

    job = await db_ingestion.create_job(
        client,
        workspace_id=workspace_id,
        source_type=req.source_type,
        source_url=req.source_url,
        source_text=req.source_text,
        stage="pending",
    )
    job_id = job["id"]

    bound = log.bind(
        job_id=job_id,
        workspace_id=workspace_id,
        source_type=req.source_type,
    )

    # ── Text pass-through (instant) ────────────────────────────────────
    if req.source_type == "text":
        bound.info("ingest_text_passthrough", text_len=len(req.source_text or ""))
        await db_ingestion.update_job(
            client,
            job_id,
            {
                "extracted_title": "",
                "extracted_text": req.source_text or "",
                "stage": "done",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return IngestResponse(
            job_id=job_id,
            extracted_title="",
            extracted_text=req.source_text or "",
            media=[],
            status="done",
        )

    # ── URL ingestion (async background) ───────────────────────────────
    # Return immediately — the heavy scrape/extract/upload work runs in
    # the background.  The client polls GET /ingest/{job_id} or listens
    # via Supabase Realtime for the stage transition to "done".
    bound.info("ingest_start_async", url=req.source_url)

    asyncio.create_task(
        _run_url_ingestion(
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            source_url=req.source_url or "",
        )
    )

    return IngestResponse(
        job_id=job_id,
        extracted_title="",
        extracted_text="",
        media=[],
        status="processing",
    )


@router.get("/ingest/{job_id}", response_model=IngestionJobResponse)
async def get_ingestion(job_id: str, request: Request) -> IngestionJobResponse:
    await verify_hmac(request, await request.body())
    _claims, token = await verify_user(request)

    client = await rls_client(token)
    # RLS guarantees the job is only visible if it belongs to the user's
    # workspace; a foreign job_id simply returns nothing.
    job = await db_ingestion.get_job(client, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Not found")
    media = await db_media.get_media_for_job(client, job_id)
    return IngestionJobResponse(job=job, media=media)
