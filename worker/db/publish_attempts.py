from typing import Any

from supabase import AsyncClient


async def create_publish_attempt(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    res = await client.table("publish_attempts").insert(values).execute()
    return res.data[0]


async def update_publish_attempt(
    client: AsyncClient, attempt_id: str, patch: dict[str, Any]
) -> None:
    await client.table("publish_attempts").update(patch).eq(
        "id", attempt_id
    ).execute()


async def get_latest_attempt(
    client: AsyncClient, post_variant_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("publish_attempts")
        .select("*")
        .eq("post_variant_id", post_variant_id)
        .order("attempt_number", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    return res.data


async def has_successful_attempt(
    client: AsyncClient, idempotency_key: str
) -> bool:
    res = (
        await client.table("publish_attempts")
        .select("id", count="exact", head=True)
        .eq("idempotency_key", idempotency_key)
        .eq("status", "success")
        .execute()
    )
    return (res.count or 0) > 0
