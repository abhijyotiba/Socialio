from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient


async def count_recent_campaigns(
    client: AsyncClient, workspace_id: str, window_seconds: int
) -> int:
    since = (
        datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    ).isoformat()
    res = (
        await client.table("campaigns")
        .select("id", count="exact", head=True)
        .eq("workspace_id", workspace_id)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


async def create_campaign(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    res = await client.table("campaigns").insert(values).execute()
    return res.data[0]


async def update_campaign(
    client: AsyncClient, campaign_id: str, patch: dict[str, Any]
) -> None:
    await client.table("campaigns").update(patch).eq("id", campaign_id).execute()


async def create_campaign_personas(
    client: AsyncClient, campaign_id: str, persona_ids: list[str]
) -> list[dict[str, Any]]:
    res = (
        await client.table("campaign_personas")
        .insert(
            [
                {"campaign_id": campaign_id, "persona_id": pid}
                for pid in persona_ids
            ]
        )
        .execute()
    )
    return res.data or []


async def set_campaign_persona_error(
    client: AsyncClient, campaign_persona_id: str, error: str
) -> None:
    await client.table("campaign_personas").update(
        {"generation_error": error}
    ).eq("id", campaign_persona_id).execute()


async def create_campaign_persona_variants(
    client: AsyncClient,
    campaign_persona_id: str,
    variants: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    res = (
        await client.table("campaign_persona_variants")
        .insert(
            [
                {
                    "campaign_persona_id": campaign_persona_id,
                    "post_variant_id": v["post_variant_id"],
                    "platform": v["platform"],
                    "prompt_version_id": v.get("prompt_version_id"),
                }
                for v in variants
            ]
        )
        .execute()
    )
    return res.data or []
