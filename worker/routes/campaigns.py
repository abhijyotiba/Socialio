import asyncio
from datetime import datetime, timezone
from typing import Any, Literal

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth import verify_hmac, verify_user
from db import audit_events as db_audit
from db import brand_configs as db_brand
from db import campaigns as db_campaigns
from db import ingestion as db_ingestion
from db import personas as db_personas
from db import posts as db_posts
from db import social_connections as db_connections
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline import analyze
from pipeline import generate as gen_pipeline

log = structlog.get_logger()

router = APIRouter()

PERSONA_SOFT_CAP = 10
GENERATION_TIMEOUT_S = 15


class CampaignRequest(BaseModel):
    ingestion_job_id: str
    persona_ids: list[str] = Field(min_length=1, max_length=PERSONA_SOFT_CAP)
    platforms: list[Literal["linkedin", "x"]] | None = None
    user_angle: str | None = None


async def _generate_for_persona(
    *,
    persona_id: str,
    brand: dict[str, Any],
    connections: list[dict[str, Any]],
    requested_platforms: list[str] | None,
    job: dict[str, Any],
    user_angle: str | None,
) -> dict[str, Any]:
    """Pure (no DB): resolve platforms and run the LLM pipeline for one persona.
    Returns {persona_id, variants} or {persona_id, error}."""
    connected = [c["platform"] for c in connections if not c.get("needs_reauth")]
    platforms = (
        [p for p in requested_platforms if p in connected]
        if requested_platforms
        else connected
    )
    if not platforms:
        return {"persona_id": persona_id, "error": "No connected platforms"}

    async def _run() -> list[dict[str, str]]:
        title = job.get("extracted_title") or ""
        text = job.get("extracted_text") or ""
        summary = await analyze.summarize(title, text) if text.strip() else ""
        return await gen_pipeline.generate_variants(
            summary=summary,
            brand_system_prompt=brand["custom_system_prompt"],
            platforms=platforms,
            user_angle=user_angle,
        )

    try:
        variants = await asyncio.wait_for(_run(), timeout=GENERATION_TIMEOUT_S)
        return {"persona_id": persona_id, "variants": variants}
    except Exception as exc:  # noqa: BLE001 — surfaced as this persona's error
        return {"persona_id": persona_id, "error": str(exc) or "Failed"}


@router.post("/campaigns")
async def create_campaign_route(req: CampaignRequest, request: Request):
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    # Rate limit: 2 campaigns per minute per workspace.
    if await db_campaigns.count_recent_campaigns(client, workspace_id, 60) >= 2:
        raise HTTPException(
            status_code=429, detail="Rate limit: 2 campaigns per minute"
        )

    user_angle = (req.user_angle or "").strip() or None
    if user_angle and len(user_angle) > 1000:
        raise HTTPException(status_code=400, detail="user_angle too long")

    job = await db_ingestion.get_job(client, req.ingestion_job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["stage"] != "done":
        raise HTTPException(status_code=409, detail="Ingestion not ready")

    has_extracted_text = bool((job.get("extracted_text") or "").strip())
    has_user_angle = bool(user_angle)
    if not has_extracted_text and not has_user_angle:
        raise HTTPException(
            status_code=409,
            detail="Ingestion job has no extracted text and no user angle was provided",
        )

    # Validate every persona is visible (RLS) i.e. belongs to this workspace.
    personas = [
        await db_personas.get_persona(client, pid) for pid in req.persona_ids
    ]
    if any(p is None for p in personas):
        raise HTTPException(status_code=403, detail="Invalid persona")

    brand_configs = [
        await db_brand.get_brand_config_for_persona(client, pid)
        for pid in req.persona_ids
    ]
    connections_by_persona = [
        await db_connections.get_connections_for_persona(client, pid)
        for pid in req.persona_ids
    ]

    if any(not (bc and bc.get("custom_system_prompt")) for bc in brand_configs):
        raise HTTPException(
            status_code=409, detail="One or more personas have no voice profile set"
        )

    # Prompt-only flow: a text job carrying a user angle means the angle IS the
    # topic — don't also feed the echoed prompt back as source material.
    effective_job = dict(job)
    if job["source_type"] == "text" and has_user_angle:
        effective_job["extracted_text"] = ""

    campaign = await db_campaigns.create_campaign(
        client,
        {
            "workspace_id": workspace_id,
            "ingestion_job_id": req.ingestion_job_id,
            "title": job.get("extracted_title"),
            "status": "generating",
            "generation_started_at": datetime.now(timezone.utc).isoformat(),
            "user_angle": user_angle,
        },
    )
    campaign_persona_rows = await db_campaigns.create_campaign_personas(
        client, campaign["id"], req.persona_ids
    )
    cp_by_persona = {row["persona_id"]: row for row in campaign_persona_rows}

    # Fire generation in parallel — one per persona.
    results = await asyncio.gather(
        *[
            _generate_for_persona(
                persona_id=pid,
                brand=brand_configs[idx],
                connections=connections_by_persona[idx] or [],
                requested_platforms=req.platforms,
                job=effective_job,
                user_angle=user_angle,
            )
            for idx, pid in enumerate(req.persona_ids)
        ],
        return_exceptions=True,
    )

    all_variants: list[dict[str, Any]] = []
    success_count = 0

    for idx, result in enumerate(results):
        if isinstance(result, BaseException):
            continue
        persona_id = result["persona_id"]
        campaign_persona = cp_by_persona[persona_id]

        if result.get("error") or not result.get("variants"):
            await db_campaigns.set_campaign_persona_error(
                client, campaign_persona["id"], result.get("error") or "Generation failed"
            )
            continue

        prompt_version_id = (brand_configs[idx] or {}).get("current_prompt_version_id")
        content_item = await db_posts.create_content_item(
            client,
            {
                "workspace_id": workspace_id,
                "ingestion_job_id": req.ingestion_job_id,
                "prompt_version_id": prompt_version_id,
            },
        )
        post_variants = await db_posts.create_post_variants(
            client,
            [
                {
                    "workspace_id": workspace_id,
                    "content_item_id": content_item["id"],
                    "platform": v["platform"],
                    "body": v["body"],
                    "status": "draft",
                    "persona_id": persona_id,
                }
                for v in result["variants"]
            ],
        )
        await db_campaigns.create_campaign_persona_variants(
            client,
            campaign_persona["id"],
            [
                {
                    "post_variant_id": pv["id"],
                    "platform": pv["platform"],
                    "prompt_version_id": prompt_version_id,
                }
                for pv in post_variants
            ],
        )
        for pv in post_variants:
            all_variants.append(
                {
                    "persona_id": persona_id,
                    "platform": pv["platform"],
                    "variant_id": pv["id"],
                    "body": pv["body"],
                }
            )
        success_count += 1

    if success_count == 0:
        final_status = "failed"
    elif success_count < len(req.persona_ids):
        final_status = "generation_partial"
    else:
        final_status = "pending_approval"

    if success_count == 0:
        await db_campaigns.update_campaign(
            client,
            campaign["id"],
            {
                "status": final_status,
                "failure_code": "ALL_PERSONAS_FAILED",
                "failure_reason": "Every persona generation attempt failed. Check that each persona has a connected platform and a voice profile.",
            },
        )
    else:
        await db_campaigns.update_campaign(
            client, campaign["id"], {"status": final_status}
        )

    await db_audit.insert_audit_event(
        client,
        {
            "workspace_id": workspace_id,
            "event_type": "campaign.created",
            "entity_type": "campaign",
            "entity_id": campaign["id"],
            "metadata": {
                "persona_count": len(req.persona_ids),
                "success_count": success_count,
            },
        },
    )

    if success_count == 0:
        return JSONResponse(
            status_code=502,
            content={
                "error": "All persona generation attempts failed",
                "campaign_id": campaign["id"],
            },
        )

    persona_map = {p["id"]: p for p in personas if p}
    return {
        "campaign_id": campaign["id"],
        "status": final_status,
        "variants": [
            {
                "persona_id": v["persona_id"],
                "persona_name": persona_map.get(v["persona_id"], {}).get(
                    "name", "Unknown"
                ),
                "platform": v["platform"],
                "variant_id": v["variant_id"],
                "body": v["body"],
            }
            for v in all_variants
        ],
    }
