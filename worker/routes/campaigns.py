import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Literal

import structlog
from fastapi import APIRouter, HTTPException, Request
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

# Mirrors web PERSONA_HARD_CAP (web/lib/constants/platforms.ts). A single
# campaign may target up to this many personas.
CAMPAIGN_PERSONA_CAP = 50
GENERATION_TIMEOUT_S = 45


class CampaignRequest(BaseModel):
    ingestion_job_id: str
    persona_ids: list[str] = Field(min_length=1, max_length=CAMPAIGN_PERSONA_CAP)
    platforms: list[Literal["linkedin", "x"]] | None = None
    user_angle: str | None = None


async def _generate_for_persona(
    *,
    persona_id: str,
    brand: dict[str, Any],
    connections: list[dict[str, Any]],
    requested_platforms: list[str] | None,
    summary: str,
    user_angle: str | None,
) -> dict[str, Any]:
    """Pure (no DB): resolve platforms and run the LLM pipeline for one persona.
    Returns {persona_id, variants} or {persona_id, error}.

    The caller is responsible for running summarization once and passing the
    result via the *summary* parameter — this avoids N duplicate LLM calls
    when generating for N personas on the same article."""
    connected = [c["platform"] for c in connections if not c.get("needs_reauth")]
    platforms = (
        [p for p in requested_platforms if p in connected]
        if requested_platforms
        else connected
    )
    if not platforms:
        return {"persona_id": persona_id, "error": "No connected platforms"}

    async def _run() -> list[dict[str, str]]:
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


async def _run_campaign_generation(
    token: str,
    campaign_id: str,
    workspace_id: str,
    ingestion_job_id: str,
    persona_ids: list[str],
    brand_configs: list[dict[str, Any] | None],
    connections_by_persona: list[list[dict[str, Any]]],
    cp_by_persona: dict[str, dict[str, Any]],
    requested_platforms: list[str] | None,
    user_angle: str | None,
    effective_title: str,
    effective_text: str,
) -> None:
    """Background task: summarize, generate per-persona in parallel, persist
    content_items/post_variants/campaign_persona_variants, and roll the campaign
    to its terminal status.

    Runs outside the original request lifecycle so the client gets an immediate
    response within the ~20s proxy timeout — the LLM calls (summarize +
    per-persona generation) happen here, not in the request path. Errors are
    recorded on the campaign / campaign_persona rows rather than surfaced as HTTP
    exceptions.

    NOTE: kept structured so a future `brief` parameter (Task 6) can be threaded
    through additively into summarization / generation.
    """
    bound = log.bind(campaign_id=campaign_id, workspace_id=workspace_id)

    # Build a fresh RLS client for the background context.
    client = await rls_client(token)

    try:
        # ── Single summarization pass (was duplicated N times per persona) ──
        summary = (
            await analyze.summarize(effective_title, effective_text)
            if effective_text.strip()
            else ""
        )

        # Fire generation in parallel — one per persona.
        results = await asyncio.gather(
            *[
                _generate_for_persona(
                    persona_id=pid,
                    brand=brand_configs[idx],
                    connections=connections_by_persona[idx] or [],
                    requested_platforms=requested_platforms,
                    summary=summary,
                    user_angle=user_angle,
                )
                for idx, pid in enumerate(persona_ids)
            ],
            return_exceptions=True,
        )

        success_count = 0

        for idx, result in enumerate(results):
            if isinstance(result, BaseException):
                continue
            persona_id = result["persona_id"]
            campaign_persona = cp_by_persona[persona_id]

            if result.get("error") or not result.get("variants"):
                await db_campaigns.set_campaign_persona_error(
                    client,
                    campaign_persona["id"],
                    result.get("error") or "Generation failed",
                )
                continue

            prompt_version_id = (brand_configs[idx] or {}).get(
                "current_prompt_version_id"
            )
            content_item = await db_posts.create_content_item(
                client,
                {
                    "workspace_id": workspace_id,
                    "ingestion_job_id": ingestion_job_id,
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
            success_count += 1

        if success_count == 0:
            final_status = "failed"
        elif success_count < len(persona_ids):
            final_status = "generation_partial"
        else:
            final_status = "pending_approval"

        if success_count == 0:
            await db_campaigns.update_campaign(
                client,
                campaign_id,
                {
                    "status": final_status,
                    "failure_code": "ALL_PERSONAS_FAILED",
                    "failure_reason": "Every persona generation attempt failed. Check that each persona has a connected platform and a voice profile.",
                },
            )
        else:
            await db_campaigns.update_campaign(
                client, campaign_id, {"status": final_status}
            )

        await db_audit.insert_audit_event(
            client,
            {
                "workspace_id": workspace_id,
                "event_type": "campaign.created",
                "entity_type": "campaign",
                "entity_id": campaign_id,
                "metadata": {
                    "persona_count": len(persona_ids),
                    "success_count": success_count,
                },
            },
        )

        bound.info(
            "campaign_generation_done",
            persona_count=len(persona_ids),
            success_count=success_count,
            status=final_status,
        )
    except Exception as exc:  # noqa: BLE001 — recorded on the campaign row
        bound.error("campaign_generation_failed", error=str(exc))
        await db_campaigns.update_campaign(
            client,
            campaign_id,
            {
                "status": "failed",
                "failure_code": "GENERATION_ERROR",
                "failure_reason": str(exc) or "Campaign generation failed.",
            },
        )


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

    # ── Batch DB reads (replaces N+1 sequential queries) ────────────────
    personas_resp = await client.table("personas").select("*").in_("id", req.persona_ids).execute()
    personas_map: dict[str, dict] = {p["id"]: p for p in (personas_resp.data or [])}
    personas = [personas_map.get(pid) for pid in req.persona_ids]
    if any(p is None for p in personas):
        raise HTTPException(status_code=403, detail="Invalid persona")

    brand_resp = await client.table("brand_configs").select("*").in_("persona_id", req.persona_ids).execute()
    brand_map: dict[str, dict] = {b["persona_id"]: b for b in (brand_resp.data or [])}
    brand_configs = [brand_map.get(pid) for pid in req.persona_ids]

    conn_resp = await client.table("social_connections").select("*").in_("persona_id", req.persona_ids).execute()
    conn_map: dict[str, list[dict]] = {}
    for c in (conn_resp.data or []):
        conn_map.setdefault(c["persona_id"], []).append(c)
    connections_by_persona = [conn_map.get(pid, []) for pid in req.persona_ids]

    if any(not (bc and bc.get("custom_system_prompt")) for bc in brand_configs):
        raise HTTPException(
            status_code=409, detail="One or more personas have no voice profile set"
        )

    # Prompt-only flow: a text job carrying a user angle means the angle IS the
    # topic — don't also feed the echoed prompt back as source material.
    effective_title = job.get("extracted_title") or ""
    effective_text = job.get("extracted_text") or ""
    if job["source_type"] == "text" and has_user_angle:
        effective_text = ""

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

    # ── Generation (async background) ──────────────────────────────────
    # Return immediately — summarization and the per-persona LLM generation
    # (which can take tens of seconds across 50 personas) run in the
    # background so the route responds well within the ~20s proxy timeout.
    # The client polls the campaign / listens for the status transition off
    # "generating".
    log.info(
        "campaign_generation_start_async",
        campaign_id=campaign["id"],
        workspace_id=workspace_id,
        persona_count=len(req.persona_ids),
    )

    asyncio.create_task(
        _run_campaign_generation(
            token=token,
            campaign_id=campaign["id"],
            workspace_id=workspace_id,
            ingestion_job_id=req.ingestion_job_id,
            persona_ids=req.persona_ids,
            brand_configs=brand_configs,
            connections_by_persona=connections_by_persona,
            cp_by_persona=cp_by_persona,
            requested_platforms=req.platforms,
            user_angle=user_angle,
            effective_title=effective_title,
            effective_text=effective_text,
        )
    )

    return {"campaign_id": campaign["id"], "status": "generating"}


# ─── Campaign management (approve / reject / cancel / delete) ─────────────────


async def _authorize(request: Request, body: bytes) -> tuple[Any, str, dict]:
    await verify_hmac(request, body)
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")
    return client, workspace_id, claims


async def _require_campaign(client: Any, campaign_id: str) -> dict:
    # RLS limits visibility to the user's workspace, so a foreign id is a 404.
    campaign = await db_campaigns.get_campaign(client, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Not found")
    return campaign


async def _maybe_mark_approved(client: Any, campaign_id: str) -> None:
    """Once every persona is resolved (approved or rejected), the campaign as a
    whole is approved. Mirrors the web `allResolved` check."""
    cps = await db_campaigns.get_campaign_personas(client, campaign_id)
    if all(cp["approval_status"] != "pending" for cp in cps):
        await db_campaigns.update_campaign(client, campaign_id, {"status": "approved"})


async def _approve_persona(
    client: Any, workspace_id: str, actor_id: str, cp: dict
) -> None:
    await db_campaigns.update_campaign_persona_approval(client, cp["id"], "approved")
    variant_ids = await db_campaigns.get_variants_for_campaign_persona(
        client, cp["id"]
    )
    await db_campaigns.set_post_variants_status(client, variant_ids, "scheduled")
    await db_audit.insert_audit_event(
        client,
        {
            "workspace_id": workspace_id,
            "persona_id": cp["persona_id"],
            "actor_user_id": actor_id,
            "event_type": "campaign_persona.approved",
            "entity_type": "campaign_persona",
            "entity_id": cp["id"],
        },
    )


@router.post("/campaigns/{campaign_id}/approve")
async def approve_campaign(campaign_id: str, request: Request) -> dict:
    body = await request.body()
    client, workspace_id, claims = await _authorize(request, body)
    await _require_campaign(client, campaign_id)

    target_ids: list[str] | None = None
    if body:
        try:
            parsed = json.loads(body)
            target_ids = parsed.get("persona_ids")
        except json.JSONDecodeError:
            target_ids = None

    cps = await db_campaigns.get_campaign_personas(client, campaign_id)
    to_approve = [
        cp
        for cp in cps
        if cp["approval_status"] == "pending"
        and (target_ids is None or cp["persona_id"] in target_ids)
    ]

    for cp in to_approve:
        await _approve_persona(client, workspace_id, claims["sub"], cp)

    await _maybe_mark_approved(client, campaign_id)
    return {"ok": True, "approved_count": len(to_approve)}


@router.post("/campaigns/{campaign_id}/persona/{persona_id}/approve")
async def approve_persona(
    campaign_id: str, persona_id: str, request: Request
) -> dict:
    body = await request.body()
    client, workspace_id, claims = await _authorize(request, body)
    await _require_campaign(client, campaign_id)

    cps = await db_campaigns.get_campaign_personas(client, campaign_id)
    cp = next((c for c in cps if c["persona_id"] == persona_id), None)
    if not cp:
        raise HTTPException(status_code=404, detail="Persona not in campaign")

    await _approve_persona(client, workspace_id, claims["sub"], cp)
    await _maybe_mark_approved(client, campaign_id)
    return {"ok": True}


@router.post("/campaigns/{campaign_id}/persona/{persona_id}/reject")
async def reject_persona(
    campaign_id: str, persona_id: str, request: Request
) -> dict:
    body = await request.body()
    client, _workspace_id, _claims = await _authorize(request, body)
    await _require_campaign(client, campaign_id)

    cps = await db_campaigns.get_campaign_personas(client, campaign_id)
    cp = next((c for c in cps if c["persona_id"] == persona_id), None)
    if not cp:
        raise HTTPException(status_code=404, detail="Persona not in campaign")

    # Rejection does NOT delete variants — just marks status.
    await db_campaigns.update_campaign_persona_approval(client, cp["id"], "rejected")
    await _maybe_mark_approved(client, campaign_id)
    return {"ok": True}


@router.post("/campaigns/{campaign_id}/cancel-scheduled")
async def cancel_scheduled(campaign_id: str, request: Request) -> dict:
    body = await request.body()
    client, _workspace_id, _claims = await _authorize(request, body)
    await _require_campaign(client, campaign_id)

    cancelled = await db_campaigns.cancel_scheduled_variants_for_campaign(
        client, campaign_id
    )
    return {"ok": True, "cancelled": cancelled}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign_route(campaign_id: str, request: Request):
    body = await request.body()
    client, _workspace_id, _claims = await _authorize(request, body)
    await _require_campaign(client, campaign_id)

    if await db_campaigns.has_live_variants(client, campaign_id):
        raise HTTPException(
            status_code=409,
            detail="Cannot delete: this campaign has variants that are scheduled or already published. Cancel or wait for them to finish first.",
        )

    await db_campaigns.delete_campaign(client, campaign_id)
    return {"ok": True}
