"""System cron jobs, ported from web/app/api/cron/*. These run with no user
context, so every DB call uses the service-role client (RLS bypass) — the same
model the web cron used (admin client)."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from supabase import AsyncClient

from adapters import cloudinary, linkedin, x
from db import audit_events as db_audit
from db import campaigns as db_campaigns
from db import media_assets as db_media
from db import metrics as db_metrics
from db import posts as db_posts
from db import publish_attempts as db_attempts
from db import social_connections as db_connections
from publish.upload_media import upload_media_for_platform
from security import vault

log = structlog.get_logger()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# publish-due
# ---------------------------------------------------------------------------


async def _resolve_connection(svc: AsyncClient, variant: dict) -> dict | None:
    platform = variant["platform"]
    if variant.get("persona_id"):
        return await db_connections.get_social_connection_for_persona(
            svc, variant["persona_id"], platform
        )
    return await db_connections.get_default_social_connection(
        svc, variant["workspace_id"], platform
    )


async def _publish_claimed_variant(svc: AsyncClient, variant: dict) -> bool:
    idempotency_key = variant["id"]

    if await db_attempts.has_successful_attempt(svc, idempotency_key):
        await db_posts.update_post_variant(svc, variant["id"], {"status": "published"})
        return True

    platform = variant["platform"]
    connection = await _resolve_connection(svc, variant)
    if (
        not connection
        or connection.get("needs_reauth")
        or not connection.get("access_token_vault_id")
    ):
        await db_posts.update_post_variant(
            svc,
            variant["id"],
            {
                "status": "failed",
                "error": "No valid connection for platform",
                "error_code": "TOKEN_EXPIRED",
            },
        )
        return False

    access_token = await vault.read_secret(svc, connection["access_token_vault_id"])

    latest = await db_attempts.get_latest_attempt(svc, variant["id"])
    attempt_number = (latest["attempt_number"] + 1) if latest else 1
    attempt = await db_attempts.create_publish_attempt(
        svc,
        {
            "workspace_id": variant["workspace_id"],
            "post_variant_id": variant["id"],
            "idempotency_key": idempotency_key,
            "attempt_number": attempt_number,
            "status": "attempting",
        },
    )

    try:
        media_urls = await db_media.get_variant_media_urls(svc, variant["id"])
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
            svc,
            attempt["id"],
            {
                "status": "success",
                "platform_post_id": result["platform_post_id"],
                "platform_post_url": result["platform_post_url"],
                "completed_at": _now(),
            },
        )
        await db_posts.update_post_variant(
            svc,
            variant["id"],
            {
                "status": "published",
                "published_at": _now(),
                "platform_post_id": result["platform_post_id"],
                "platform_post_url": result["platform_post_url"],
            },
        )
        return True
    except Exception as err:  # noqa: BLE001 — recorded as a failed attempt
        error_code = getattr(err, "error_code", "UNKNOWN")
        error_detail = str(err) or "Unknown error"
        await db_attempts.update_publish_attempt(
            svc,
            attempt["id"],
            {
                "status": "failed",
                "error_code": error_code,
                "error_detail": error_detail,
                "completed_at": _now(),
            },
        )
        await db_posts.update_post_variant(
            svc,
            variant["id"],
            {"status": "failed", "error": error_detail, "error_code": error_code},
        )
        return False


async def run_publish_due(svc: AsyncClient) -> dict:
    # Zombie campaign cleanup: 'generating' past the 3-minute window → failed.
    zombies = await db_campaigns.fail_zombie_campaigns(svc)
    if zombies:
        await db_campaigns.reject_pending_personas(svc, [c["id"] for c in zombies])
        for c in zombies:
            await db_audit.insert_audit_event(
                svc,
                {
                    "workspace_id": c["workspace_id"],
                    "entity_type": "campaign",
                    "entity_id": c["id"],
                    "event_type": "campaign.zombie_timeout",
                    "metadata": {"reason": "generation_exceeded_3_minutes"},
                },
            )

    swept = await db_posts.sweep_stuck_publishing(svc)

    worker_id = str(uuid.uuid4())
    claimed = await db_posts.claim_due_variants(svc, worker_id, 10)

    results = await asyncio.gather(
        *(_publish_claimed_variant(svc, v) for v in claimed),
        return_exceptions=True,
    )
    succeeded = sum(1 for r in results if r is True)
    failed = len(results) - succeeded

    return {
        "swept": swept,
        "attempted": len(claimed),
        "succeeded": succeeded,
        "failed": failed,
    }


# ---------------------------------------------------------------------------
# pull-metrics
# ---------------------------------------------------------------------------


async def run_pull_metrics(svc: AsyncClient) -> dict:
    since_iso = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    variants = await db_posts.get_published_variants_for_metrics(svc, since_iso, 50)

    # Limit concurrency to avoid overwhelming external APIs / DB connections.
    sem = asyncio.Semaphore(5)

    async def _sync_one(variant: dict) -> str:
        """Returns 'synced', 'skipped', or 'failed'."""
        async with sem:
            try:
                platform = variant["platform"]
                connection = await _resolve_connection(svc, variant)
                if (
                    not connection
                    or connection.get("needs_reauth")
                    or not connection.get("access_token_vault_id")
                ):
                    raise RuntimeError("Missing valid connection")

                access_token = await vault.read_secret(
                    svc, connection["access_token_vault_id"]
                )
                if platform == "linkedin":
                    payload = await linkedin.get_post_metrics(
                        access_token,
                        f"urn:li:person:{connection['platform_user_id']}",
                        variant["platform_post_id"],
                    )
                else:
                    payload = await x.get_post_metrics(
                        access_token, variant["platform_post_id"]
                    )

                await db_metrics.upsert_post_metrics(
                    svc,
                    {
                        "post_variant_id": variant["id"],
                        "workspace_id": variant["workspace_id"],
                        "impressions": payload["impressions"],
                        "likes": payload["likes"],
                        "comments": payload["comments"],
                        "shares": payload["shares"],
                        "last_synced_at": _now(),
                    },
                )
                return "synced"
            except Exception as exc:  # noqa: BLE001
                # POST_DELETED means the user removed the post on-platform —
                # stop syncing it, but it's not a failure.
                if getattr(exc, "error_code", None) == "POST_DELETED":
                    return "skipped"
                return "failed"

    results = await asyncio.gather(
        *(_sync_one(v) for v in variants),
        return_exceptions=True,
    )

    checked = len(variants)
    synced = sum(1 for r in results if r == "synced")
    failed = sum(1 for r in results if r == "failed" or isinstance(r, BaseException))
    return {"checked": checked, "synced": synced, "failed": failed}


# ---------------------------------------------------------------------------
# token-expiry-check
# ---------------------------------------------------------------------------


async def _refresh_connection(svc: AsyncClient, connection: dict) -> str:
    if not connection.get("refresh_token_vault_id"):
        await db_connections.flag_needs_reauth(svc, connection["id"])
        return "flagged"

    try:
        refresh_value = await vault.read_secret(
            svc, connection["refresh_token_vault_id"]
        )
        adapter = linkedin if connection["platform"] == "linkedin" else x
        result = await adapter.refresh_token(refresh_value)

        new_access_vault = await vault.create_secret(
            svc,
            result["access_token"],
            f"{connection['platform']}:access:{connection['workspace_id']}:{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        )
        token_expires_at = (
            (
                datetime.now(timezone.utc)
                + timedelta(seconds=result["expires_in"])
            ).isoformat()
            if result.get("expires_in")
            else None
        )
        updates = {
            "access_token_vault_id": new_access_vault,
            "token_expires_at": token_expires_at,
            "needs_reauth": False,
        }
        if result.get("new_refresh_token"):
            updates["refresh_token_vault_id"] = await vault.create_secret(
                svc,
                result["new_refresh_token"],
                f"{connection['platform']}:refresh:{connection['workspace_id']}:{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            )
        await db_connections.update_connection_tokens(svc, connection["id"], updates)
        return "refreshed"
    except Exception:  # noqa: BLE001 — any failure → flag for manual reconnect
        await db_connections.flag_needs_reauth(svc, connection["id"])
        return "flagged"


async def run_token_expiry_check(svc: AsyncClient) -> dict:
    cutoff = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    connections = await db_connections.get_expiring_connections(svc, cutoff)

    results = await asyncio.gather(
        *(_refresh_connection(svc, c) for c in connections),
        return_exceptions=True,
    )
    refreshed = sum(1 for r in results if r == "refreshed")
    flagged = len(results) - refreshed
    return {"checked": len(connections), "refreshed": refreshed, "flagged": flagged}


# ---------------------------------------------------------------------------
# cleanup-orphaned-media
# ---------------------------------------------------------------------------


async def run_cleanup_orphaned_media(svc: AsyncClient) -> dict:
    orphans = await db_media.get_orphaned_media_assets(svc)
    if not orphans:
        return {"deleted": 0, "failed": 0}

    # Delete from Cloudinary first; only remove DB rows for assets that left
    # Cloudinary cleanly. A partial failure is retried next run (delete is
    # idempotent).
    results = await asyncio.gather(
        *(cloudinary.delete_asset(o["cloudinary_id"]) for o in orphans),
        return_exceptions=True,
    )
    deleted_ids = [
        o["id"]
        for o, r in zip(orphans, results)
        if not isinstance(r, Exception)
    ]
    failed_count = sum(1 for r in results if isinstance(r, Exception))
    if failed_count:
        log.warning("cleanup_cloudinary_partial_failure", failed=failed_count)

    await db_media.delete_media_assets_by_ids(svc, deleted_ids)
    return {"deleted": len(deleted_ids), "failed": failed_count}
