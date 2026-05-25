from typing import Any

import structlog
from supabase import AsyncClient

log = structlog.get_logger()


async def insert_audit_event(client: AsyncClient, event: dict[str, Any]) -> None:
    """Audit logging must never break the main flow — all errors swallowed."""
    try:
        await client.table("audit_events").insert(event).execute()
    except Exception as exc:  # noqa: BLE001 — audit must never raise
        log.warning("audit_event_insert_failed", error=str(exc))
