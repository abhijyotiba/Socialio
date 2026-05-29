"""Planned matrix cells live in content_items (status='planned'|'rendered').

Materialize = bulk-insert planned cells (dedup via the partial unique index on
matrix_cell_hash — collisions are ignored). Reservoir = count of planned cells
for a persona+platform. Drain = fetch the next planned cells to render.
"""

from typing import Any
from supabase import AsyncClient


async def materialize_cells(
    client: AsyncClient, cells: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not cells:
        return []
    # ignore_duplicates: a cell whose matrix_cell_hash already exists is silently
    # skipped — this IS the "never repeat a cell" guarantee at the DB layer.
    res = (
        await client.table("content_items")
        .upsert(cells, on_conflict="matrix_cell_hash", ignore_duplicates=True)
        .execute()
    )
    return res.data or []


async def count_reservoir(
    client: AsyncClient, persona_id: str, platform: str
) -> int:
    """Reservoir level = planned cells not yet rendered/scheduled."""
    res = (
        await client.table("content_items")
        .select("id", count="exact", head=True)
        .eq("persona_id", persona_id)
        .eq("platform", platform)
        .eq("status", "planned")
        .execute()
    )
    return res.count or 0


async def next_planned_cells(
    client: AsyncClient, persona_id: str, platform: str, limit: int
) -> list[dict[str, Any]]:
    """Oldest-first drain order for v1. Join the idea for render inputs.
    (Smart ordering is deferred — see deferred doc D1.)"""
    res = (
        await client.table("content_items")
        .select("*, content_ideas(essence, source_quote)")
        .eq("persona_id", persona_id)
        .eq("platform", platform)
        .eq("status", "planned")
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    return res.data or []


async def mark_cell_rendered(
    client: AsyncClient, content_item_id: str
) -> None:
    await (
        client.table("content_items")
        .update({"status": "rendered"})
        .eq("id", content_item_id)
        .execute()
    )
