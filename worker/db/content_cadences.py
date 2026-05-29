from datetime import datetime, timezone
from typing import Any
from supabase import AsyncClient


async def upsert_cadence(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    """Create or update the cadence for a (persona, platform). One row each."""
    payload = {**values, "updated_at": datetime.now(timezone.utc).isoformat()}
    res = (
        await client.table("content_cadences")
        .upsert(payload, on_conflict="persona_id,platform")
        .execute()
    )
    return res.data[0]


async def list_cadences_for_workspace(
    client: AsyncClient, workspace_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("content_cadences")
        .select("*")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return res.data or []


async def list_active_cadences(client: AsyncClient) -> list[dict[str, Any]]:
    """Service-role only — the refill cron iterates every active cadence."""
    res = (
        await client.table("content_cadences")
        .select("*")
        .eq("active", True)
        .execute()
    )
    return res.data or []


async def mark_low_nudge_sent(client: AsyncClient, cadence_id: str) -> None:
    await (
        client.table("content_cadences")
        .update({"last_low_nudge_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", cadence_id)
        .execute()
    )
