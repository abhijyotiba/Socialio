from typing import Any

from supabase import AsyncClient


async def upsert_post_metrics(
    client: AsyncClient, metrics: dict[str, Any]
) -> None:
    await client.table("post_metrics").upsert(
        metrics, on_conflict="post_variant_id"
    ).execute()
