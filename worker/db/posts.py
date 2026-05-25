from typing import Any

from supabase import AsyncClient


async def create_content_item(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    res = await client.table("content_items").insert(values).execute()
    return res.data[0]


async def create_post_variants(
    client: AsyncClient, variants: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not variants:
        return []
    res = await client.table("post_variants").insert(variants).execute()
    return res.data or []


async def get_post_variant(
    client: AsyncClient, variant_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("post_variants")
        .select("*")
        .eq("id", variant_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def update_post_variant(
    client: AsyncClient, variant_id: str, patch: dict[str, Any]
) -> None:
    await client.table("post_variants").update(patch).eq("id", variant_id).execute()


async def claim_due_variants(
    client: AsyncClient, worker_id: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Atomically claim scheduled variants whose time has come, via the
    Postgres FOR UPDATE SKIP LOCKED RPC. Service-role client only."""
    res = await client.rpc(
        "claim_due_variants", {"p_worker_id": worker_id, "p_limit": limit}
    ).execute()
    return res.data or []


async def sweep_stuck_publishing(
    client: AsyncClient, older_than_minutes: int = 10
) -> int:
    """Reset variants stuck in 'publishing' (a worker died mid-publish) back to
    'scheduled' so the next sweep retries them. Returns count reset."""
    from datetime import datetime, timedelta, timezone

    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    ).isoformat()
    res = (
        await client.table("post_variants")
        .update({"status": "scheduled"})
        .eq("status", "publishing")
        .lt("claimed_at", cutoff)
        .select("id")
        .execute()
    )
    return len(res.data or [])


async def get_published_variants_for_metrics(
    client: AsyncClient, since_iso: str, limit: int = 50
) -> list[dict[str, Any]]:
    res = (
        await client.table("post_variants")
        .select("*")
        .eq("status", "published")
        .not_.is_("platform_post_id", "null")
        .gt("published_at", since_iso)
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


async def get_content_item_summary(
    client: AsyncClient, content_item_id: str
) -> str | None:
    res = (
        await client.table("content_items")
        .select("summary")
        .eq("id", content_item_id)
        .maybe_single()
        .execute()
    )
    if not res.data:
        return None
    return res.data.get("summary")
