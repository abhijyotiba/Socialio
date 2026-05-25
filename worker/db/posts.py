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
