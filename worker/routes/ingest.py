import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import verify_hmac
from pipeline import extract, scrape, upload

router = APIRouter()


class IngestRequest(BaseModel):
    job_id: str
    workspace_id: str
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
    extracted_title: str
    extracted_text: str
    media: list[MediaItem]
    stage_timings: dict[str, int]


def _ms() -> int:
    return int(time.monotonic() * 1000)


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request) -> IngestResponse:
    body = await request.body()
    await verify_hmac(request, body)

    if req.source_type == "text":
        return IngestResponse(
            extracted_title="",
            extracted_text=req.source_text or "",
            media=[],
            stage_timings={},
        )

    t0 = _ms()
    try:
        html = await scrape.fetch_html(req.source_url or "")
    except scrape.ScrapeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    t1 = _ms()

    extracted = extract.parse(html, base_url=req.source_url or "")
    t2 = _ms()

    media = await upload.to_cloudinary(extracted.media_urls, req.workspace_id)
    t3 = _ms()

    return IngestResponse(
        extracted_title=extracted.title,
        extracted_text=extracted.text,
        media=[MediaItem(**m) for m in media],
        stage_timings={
            "scraping": t1 - t0,
            "extracting": t2 - t1,
            "uploading": t3 - t2,
        },
    )
