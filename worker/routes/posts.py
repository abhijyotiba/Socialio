from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from adapters import linkedin, x
from auth import verify_hmac, verify_user
from db import brand_configs as db_brand
from db import media_assets as db_media
from db import post_variant_revisions as db_revisions
from db import posts as db_posts
from db import publish_attempts as db_attempts
from db import social_connections as db_connections
from db.client import rls_client, service_client
from db.workspaces import get_workspace_id_for_user
from pipeline import regenerate as regen_pipeline
from publish.upload_media import upload_media_for_platform
from security import vault

log = structlog.get_logger()

router = APIRouter()

EDITABLE_STATUSES = ("draft", "scheduled", "failed")
PUBLISHABLE_STATUSES = ("draft", "failed")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


@router.post("/posts/{variant_id}/publish")
async def publish_variant(variant_id: str, request: Request):
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
    if variant["status"] not in PUBLISHABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot publish a variant with status '{variant['status']}'",
        )

    # Idempotency guard — never double-publish a successful variant.
    idempotency_key = variant["id"]
    if await db_attempts.has_successful_attempt(client, idempotency_key):
        raise HTTPException(
            status_code=409, detail="This variant has already been published"
        )

    platform = variant["platform"]
    connection = (
        await db_connections.get_social_connection_for_persona(
            client, variant["persona_id"], platform
        )
        if variant.get("persona_id")
        else await db_connections.get_default_social_connection(
            client, workspace_id, platform
        )
    )
    if not connection:
        raise HTTPException(
            status_code=409, detail=f"No {platform} account connected"
        )
    if connection.get("needs_reauth"):
        raise HTTPException(
            status_code=409,
            detail=f"{platform} account needs re-authentication",
        )

    latest = await db_attempts.get_latest_attempt(client, variant_id)
    attempt_number = (latest["attempt_number"] + 1) if latest else 1

    # Claim the variant — prevents a duplicate in-flight publish.
    await db_posts.update_post_variant(client, variant_id, {"status": "publishing"})

    # Vault read requires the service-role client (documented exception).
    svc = await service_client()
    access_token = await vault.read_secret(
        svc, connection["access_token_vault_id"]
    )

    attempt = await db_attempts.create_publish_attempt(
        client,
        {
            "workspace_id": workspace_id,
            "post_variant_id": variant_id,
            "idempotency_key": idempotency_key,
            "attempt_number": attempt_number,
            "status": "attempting",
        },
    )

    try:
        media_urls = await db_media.get_variant_media_urls(client, variant_id)
        author_urn = (
            f"urn:li:person:{connection['platform_user_id']}"
            if platform == "linkedin"
            else None
        )
        platform_media_ids = await upload_media_for_platform(
            platform, access_token, media_urls, author_urn
        )
        media_arg = platform_media_ids or None

        if platform == "linkedin":
            result = await linkedin.publish_post(
                access_token, author_urn, variant["body"], idempotency_key, media_arg
            )
        else:
            result = await x.publish_tweet(access_token, variant["body"], media_arg)

        await db_attempts.update_publish_attempt(
            client,
            attempt["id"],
            {
                "status": "success",
                "platform_post_id": result["platform_post_id"],
                "platform_post_url": result["platform_post_url"],
                "completed_at": _now(),
            },
        )
        await db_posts.update_post_variant(
            client,
            variant_id,
            {
                "status": "published",
                "published_at": _now(),
                "platform_post_id": result["platform_post_id"],
                "platform_post_url": result["platform_post_url"],
            },
        )
        return {
            "status": "published",
            "platform_post_url": result["platform_post_url"],
        }
    except Exception as err:  # noqa: BLE001 — recorded as a failed attempt
        error_code = getattr(err, "error_code", "UNKNOWN")
        error_detail = str(err) or "Unknown error"
        await db_attempts.update_publish_attempt(
            client,
            attempt["id"],
            {
                "status": "failed",
                "error_code": error_code,
                "error_detail": error_detail,
                "completed_at": _now(),
            },
        )
        await db_posts.update_post_variant(
            client,
            variant_id,
            {"status": "failed", "error": error_detail, "error_code": error_code},
        )
        http_status = 401 if error_code == "TOKEN_EXPIRED" else 502
        return JSONResponse(
            status_code=http_status,
            content={"error": error_detail, "error_code": error_code},
        )


class ScheduleRequest(BaseModel):
    scheduled_at: str


@router.post("/posts/{variant_id}/schedule")
async def schedule_post(
    variant_id: str, req: ScheduleRequest, request: Request
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
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        scheduled_dt = datetime.fromisoformat(req.scheduled_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="scheduled_at must be an ISO 8601 datetime string"
        ) from exc

    if scheduled_dt <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=400, detail="scheduled_at must be in the future"
        )

    if variant["status"] not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot schedule a variant with status '{variant['status']}'",
        )

    await db_posts.update_post_variant(
        client, variant_id, {"status": "scheduled", "scheduled_at": req.scheduled_at}
    )
    return {"status": "scheduled", "scheduled_at": req.scheduled_at}


@router.post("/posts/{variant_id}/cancel")
async def cancel_post(variant_id: str, request: Request) -> dict:
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
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if variant["status"] != "scheduled":
        raise HTTPException(
            status_code=409,
            detail="Only scheduled variants can be cancelled",
        )

    await db_posts.update_post_variant(
        client, variant_id, {"status": "cancelled", "scheduled_at": None}
    )
    return {"status": "cancelled"}


class ReviewRequest(BaseModel):
    action: str  # "approve" | "reject"


@router.post("/posts/{variant_id}/review")
async def review_post(
    variant_id: str, req: ReviewRequest, request: Request
) -> dict:
    """Batch-review action for content-engine posts awaiting approval.
    approve → 'draft' (re-enters the normal publish/schedule flow);
    reject  → 'cancelled'."""
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    if req.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    variant = await db_posts.get_post_variant(client, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Post variant not found")
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if variant["status"] != "pending_approval":
        raise HTTPException(
            status_code=409,
            detail="Only posts awaiting approval can be reviewed.",
        )

    new_status = "draft" if req.action == "approve" else "cancelled"
    await db_posts.update_post_variant(client, variant_id, {"status": new_status})
    return {"status": new_status}


class PatchPostRequest(BaseModel):
    body: str = Field(min_length=1)


PLATFORM_CHAR_LIMITS = {"linkedin": 3000, "x": 280}


@router.patch("/posts/{variant_id}")
async def patch_post(
    variant_id: str, req: PatchPostRequest, request: Request
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
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    limit = PLATFORM_CHAR_LIMITS.get(variant["platform"], 3000)
    if len(req.body) > limit:
        raise HTTPException(
            status_code=400,
            detail=f"Body exceeds limit of {limit} characters for {variant['platform']}",
        )

    await db_posts.update_post_variant(client, variant_id, {"body": req.body})
    return {"saved": True}


class UpdateMediaRequest(BaseModel):
    media_asset_ids: list[str]


@router.put("/posts/{variant_id}/media")
async def update_post_media(
    variant_id: str, req: UpdateMediaRequest, request: Request
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
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if len(req.media_asset_ids) > 4:
        raise HTTPException(
            status_code=400, detail="Maximum 4 media attachments per post variant"
        )

    try:
        await db_media.set_variant_media(client, variant_id, req.media_asset_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"saved": True}


class RevertRequest(BaseModel):
    revision_number: int


@router.post("/posts/{variant_id}/revert")
async def revert_post(
    variant_id: str, req: RevertRequest, request: Request
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
    if variant["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if variant["status"] not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Can't revert a post that's {variant['status']}.",
        )

    revisions = await db_revisions.list_variant_revisions(client, variant_id)
    target = None
    for r in revisions:
        if r["revision_number"] == req.revision_number:
            target = r
            break

    if not target:
        raise HTTPException(status_code=404, detail="Revision not found")

    # Snapshot current body before overwriting it
    new_snapshot = await db_revisions.snapshot_variant_body(
        client,
        variant_id=variant_id,
        workspace_id=workspace_id,
        body=variant["body"],
        instruction=f"reverted to revision {target['revision_number']}",
    )

    await db_posts.update_post_variant(client, variant_id, {"body": target["body"]})
    return {
        "body": target["body"],
        "revision_number": new_snapshot["revision_number"],
    }

