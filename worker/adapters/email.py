"""Fire-and-forget email notifications via Resend.

If RESEND_API_KEY is not configured every call is a silent no-op so the worker
can run without an email provider in dev/staging. Rate-limiting (max 10/hour
per workspace) prevents quota exhaustion when many posts fail at once.
"""

from __future__ import annotations

import time
from collections import defaultdict

import httpx
import structlog

from config import settings

log = structlog.get_logger()

# In-memory per-workspace rate limiting. A production deploy restarts the
# process, so stale counters are acceptable — the worst case is a few extra
# emails in the first hour after a restart.
_MAX_PER_HOUR = 10
_WINDOW_S = 3600
_timestamps: dict[str, list[float]] = defaultdict(list)


def _within_rate_limit(workspace_id: str) -> bool:
    """Return True if `workspace_id` hasn't exceeded 10 emails in the last hour."""
    now = time.monotonic()
    stamps = _timestamps[workspace_id]
    # Prune expired timestamps
    cutoff = now - _WINDOW_S
    while stamps and stamps[0] < cutoff:
        stamps.pop(0)
    if len(stamps) < _MAX_PER_HOUR:
        stamps.append(now)
        return True
    return False


async def send_notification_email(
    to_email: str,
    subject: str,
    body: str,
    *,
    workspace_id: str = "",
) -> None:
    """Send a transactional email. No-op if RESEND_API_KEY is not set or the
    workspace has hit the rate limit. Errors are logged but never raised —
    email delivery failure must not break the flow that triggered it."""
    if not settings.resend_api_key:
        return
    if workspace_id and not _within_rate_limit(workspace_id):
        log.info("email_rate_limited", workspace_id=workspace_id)
        return

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.resend_from_address or "SocialOS <noreply@socialos.app>",
                    "to": [to_email],
                    "subject": subject,
                    "text": body,
                },
            )
            if resp.status_code >= 400:
                log.warning(
                    "email_send_failed",
                    status=resp.status_code,
                    body=resp.text[:200],
                )
            else:
                log.info("email_sent", to=to_email, subject=subject)
    except Exception as exc:  # noqa: BLE001 — fire-and-forget
        log.warning("email_send_error", error=str(exc))
