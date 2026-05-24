import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_hmac, verify_user
from db import brand_configs as db_brand
from db import post_variant_revisions as db_revisions
from db import posts as db_posts
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline import regenerate as regen_pipeline

log = structlog.get_logger()

router = APIRouter()

EDITABLE_STATUSES = ("draft", "scheduled", "failed")


class RegenerateRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=500)


@router.post("/posts/{variant_id}/regenerate")
async def regenerate_post(
    variant_id: str, req: RegenerateRequest, request: Request
) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    variant = await db_posts.get_post_variant(client, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Post variant not found")

    if variant["status"] not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Can't regenerate a post that's {variant['status']}.",
        )

    # Persona-scoped brand is the contract; fall back to workspace-default for
    # pre-persona variants whose persona_id is NULL.
    brand = (
        await db_brand.get_brand_config_for_persona(client, variant["persona_id"])
        if variant.get("persona_id")
        else await db_brand.get_default_brand_config(client, workspace_id)
    )
    if not (brand and brand.get("custom_system_prompt")):
        raise HTTPException(
            status_code=400,
            detail="Set up your brand voice in Settings before regenerating posts.",
        )

    summary = await db_posts.get_content_item_summary(
        client, variant["content_item_id"]
    )

    # Snapshot the current body BEFORE calling the model so history is complete
    # even if regeneration fails.
    await db_revisions.snapshot_variant_body(
        client,
        variant_id=variant["id"],
        workspace_id=workspace_id,
        body=variant["body"],
        instruction=None,
    )

    try:
        new_body = await regen_pipeline.regenerate_variant(
            platform=variant["platform"],
            current_body=variant["body"],
            instruction=req.instruction,
            brand_system_prompt=brand["custom_system_prompt"],
            summary=summary,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("regenerate_failed", variant_id=variant_id, error=str(exc))
        raise HTTPException(
            status_code=502,
            detail="Regeneration is temporarily unavailable. Please try again.",
        ) from exc

    await db_posts.update_post_variant(client, variant["id"], {"body": new_body})

    new_snapshot = await db_revisions.snapshot_variant_body(
        client,
        variant_id=variant["id"],
        workspace_id=workspace_id,
        body=new_body,
        instruction=req.instruction,
    )

    return {"body": new_body, "revision_number": new_snapshot["revision_number"]}
