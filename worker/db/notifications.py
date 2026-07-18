from datetime import datetime, timezone
from typing import Any

import structlog
from supabase import AsyncClient

log = structlog.get_logger()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def insert_notification(client: AsyncClient, values: dict[str, Any]) -> None:
    """Insert an in-app notification. Alerting must never break the flow that
    triggered it (a failed publish is already the bad outcome), so all errors
    are swallowed — mirrors db.audit_events.insert_audit_event."""
    try:
        await client.table("notifications").insert(values).execute()
    except Exception as exc:  # noqa: BLE001 — alerting must never raise
        log.warning("notification_insert_failed", error=str(exc))


async def mark_read(client: AsyncClient, notification_id: str) -> bool:
    """Mark one notification read (RLS scopes it to the caller's workspace).
    Returns False when nothing matched (wrong id / not visible)."""
    res = (
        await client.table("notifications")
        .update({"read_at": _now()})
        .eq("id", notification_id)
        .is_("read_at", "null")
        .select("id")
        .execute()
    )
    return bool(res.data)


async def mark_all_read(client: AsyncClient, workspace_id: str) -> int:
    """Mark every unread notification in the workspace read; returns the count."""
    res = (
        await client.table("notifications")
        .update({"read_at": _now()})
        .eq("workspace_id", workspace_id)
        .is_("read_at", "null")
        .select("id")
        .execute()
    )
    return len(res.data or [])

