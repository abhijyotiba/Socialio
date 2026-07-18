"""Single publish path shared by the manual-publish route and the publish-due
cron. Both callers resolve/validate the connection themselves (RLS/auth/claim
differ), then hand the variant + connection here. This module owns the parts
that were previously duplicated verbatim: the idempotency guard, media upload,
the adapter ``publish(...)`` call, and the ``publish_attempts`` /
``post_variants`` writes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from adapters.platforms import get_adapter
from db import media_assets as db_media
from db import notifications as db_notifications
from db import persona_rate_limits as db_rate_limits
from db import posts as db_posts
from db import publish_attempts as db_attempts
from publish.upload_media import upload_media_for_platform
from security import vault

# Error codes (from adapter.classify_error / PublishError.error_code) that are
# worth retrying — transient platform conditions. Everything else (CONTENT_POLICY,
# TOKEN_EXPIRED after a failed refresh, UNKNOWN) is terminal on first failure.
RETRYABLE_ERROR_CODES = frozenset({"RATE_LIMITED", "SERVER_ERROR"})

# Backoff schedule in minutes, indexed by the pre-increment retry_count. A
# variant is retried at most 3 times (retry_count 0→1→2), then goes terminal.
RETRY_BACKOFF_MINUTES = (5, 15, 60)
MAX_RETRIES = len(RETRY_BACKOFF_MINUTES)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_retry_at(retry_count: int, retry_after_seconds: float | None) -> str:
    """When to next attempt a retryable failure. Honor the platform's
    Retry-After (seconds) when it exposed one; otherwise fall back to the fixed
    5/15/60-minute backoff schedule indexed by the current retry_count."""
    if retry_after_seconds is not None:
        delta = timedelta(seconds=retry_after_seconds)
    else:
        minutes = RETRY_BACKOFF_MINUTES[min(retry_count, MAX_RETRIES - 1)]
        delta = timedelta(minutes=minutes)
    return (datetime.now(timezone.utc) + delta).isoformat()


@dataclass
class PublishResult:
    """Outcome of a publish attempt. ``ok`` is the only field callers must
    check; ``error_code`` drives the route's 401-vs-502 mapping and the
    ``platform_post_*`` fields populate the success response."""

    ok: bool
    error_code: str | None = None
    error_detail: str | None = None
    platform_post_id: str | None = None
    platform_post_url: str | None = None


async def publish_variant(
    client,
    svc,
    variant: dict,
    connection: dict,
    *,
    idempotency_key: str,
) -> PublishResult:
    """Publish ``variant`` to its platform through the connection's token.

    ``client`` is used for every table write (RLS-scoped in the route, service
    role in cron); ``svc`` is the service-role client Vault reads require. The
    caller is responsible for having claimed the variant and validated the
    connection. Never raises — platform failures are recorded as a failed
    attempt and surfaced via ``PublishResult(ok=False, error_code=...)``.
    """
    # Idempotency guard — a variant with a successful attempt is already live,
    # so re-mark it published and short-circuit without touching the platform.
    if await db_attempts.has_successful_attempt(client, idempotency_key):
        await db_posts.update_post_variant(client, variant["id"], {"status": "published"})
        return PublishResult(ok=True)

    platform = variant["platform"]
    adapter = get_adapter(platform)
    author_urn = adapter.build_author_urn(connection["platform_user_id"])

    access_token = await vault.read_secret(svc, connection["access_token_vault_id"])

    latest = await db_attempts.get_latest_attempt(client, variant["id"])
    attempt_number = (latest["attempt_number"] + 1) if latest else 1
    attempt = await db_attempts.create_publish_attempt(
        client,
        {
            "workspace_id": variant["workspace_id"],
            "post_variant_id": variant["id"],
            "idempotency_key": idempotency_key,
            "attempt_number": attempt_number,
            "status": "attempting",
        },
    )

    try:
        media_urls = await db_media.get_variant_media_urls(client, variant["id"])
        platform_media_ids = await upload_media_for_platform(
            platform, access_token, media_urls, author_urn
        )
        media_arg = platform_media_ids or None

        result = await adapter.publish(
            access_token=access_token,
            body=variant["body"],
            media_ids=media_arg,
            idempotency_key=idempotency_key,
            author_urn=author_urn,
        )

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
            variant["id"],
            {
                "status": "published",
                "published_at": _now(),
                "platform_post_id": result["platform_post_id"],
                "platform_post_url": result["platform_post_url"],
            },
        )
        # Live daily-cap counter: only meaningful for persona-scoped variants
        # (the cap is per persona+platform). Uses the service-role client since
        # the RPC is service_role-only.
        if variant.get("persona_id"):
            await db_rate_limits.increment(svc, variant["persona_id"], platform)
        return PublishResult(
            ok=True,
            platform_post_id=result["platform_post_id"],
            platform_post_url=result["platform_post_url"],
        )
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

        retry_count = variant.get("retry_count") or 0
        is_retryable = error_code in RETRYABLE_ERROR_CODES

        if is_retryable and retry_count < MAX_RETRIES:
            # Transient failure with retries left → back off and let the next
            # claim_due_variants sweep re-pick it once next_retry_at passes.
            retry_after = getattr(err, "retry_after", None)
            await db_posts.update_post_variant(
                client,
                variant["id"],
                {
                    "status": "failed",
                    "error": error_detail,
                    "error_code": error_code,
                    "retry_count": retry_count + 1,
                    "next_retry_at": _next_retry_at(retry_count, retry_after),
                },
            )
        else:
            # Non-retryable, or retries exhausted → give up and alert the user.
            await db_posts.update_post_variant(
                client,
                variant["id"],
                {
                    "status": "failed_terminal",
                    "error": error_detail,
                    "error_code": error_code,
                    "next_retry_at": None,
                },
            )
            await db_notifications.insert_notification(
                client,
                {
                    "workspace_id": variant["workspace_id"],
                    "persona_id": variant.get("persona_id"),
                    "kind": "publish_failed",
                    "title": f"Publishing to {platform} failed",
                    "body": error_detail,
                    "entity_type": "post_variant",
                    "entity_id": variant["id"],
                },
            )

        return PublishResult(
            ok=False, error_code=error_code, error_detail=error_detail
        )
