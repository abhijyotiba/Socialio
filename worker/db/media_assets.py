from typing import Any

from supabase import AsyncClient


async def create_media_assets(
    client: AsyncClient,
    workspace_id: str,
    job_id: str,
    items: list[dict[str, Any]],
) -> None:
    if not items:
        return
    rows = [
        {
            "workspace_id": workspace_id,
            "ingestion_job_id": job_id,
            "cloudinary_url": m["cloudinary_url"],
            "cloudinary_id": m["cloudinary_id"],
            "resource_type": m["resource_type"],
            "format": m["format"],
            "bytes": m["bytes"],
            "width": m["width"],
            "height": m["height"],
        }
        for m in items
    ]
    await client.table("media_assets").insert(rows).execute()


async def get_media_for_job(
    client: AsyncClient, job_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("media_assets")
        .select("*")
        .eq("ingestion_job_id", job_id)
        .execute()
    )
    return res.data or []


async def get_orphaned_media_assets(
    client: AsyncClient, older_than_minutes: int = 60
) -> list[dict[str, Any]]:
    """User-uploaded assets older than the grace period that were never linked
    to a post variant. Ingestion assets (ingestion_job_id set) are never
    orphaned. Two-step diff — mirrors web's getOrphanedMediaAssets."""
    from datetime import datetime, timedelta, timezone

    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    ).isoformat()
    candidates = (
        await client.table("media_assets")
        .select("id, cloudinary_id")
        .lt("created_at", cutoff)
        .is_("ingestion_job_id", "null")
        .execute()
    ).data or []
    if not candidates:
        return []

    candidate_ids = [c["id"] for c in candidates]
    linked = (
        await client.table("post_variant_media")
        .select("media_asset_id")
        .in_("media_asset_id", candidate_ids)
        .execute()
    ).data or []
    linked_ids = {row["media_asset_id"] for row in linked}
    return [c for c in candidates if c["id"] not in linked_ids]


async def delete_media_assets_by_ids(
    client: AsyncClient, ids: list[str]
) -> None:
    if not ids:
        return
    await client.table("media_assets").delete().in_("id", ids).execute()


async def get_variant_media_urls(
    client: AsyncClient, post_variant_id: str
) -> list[str]:
    """Ordered Cloudinary URLs attached to a variant, for publishing."""
    res = (
        await client.table("post_variant_media")
        .select("position, media_assets(cloudinary_url)")
        .eq("post_variant_id", post_variant_id)
        .order("position")
        .execute()
    )
    urls: list[str] = []
    for row in res.data or []:
        asset = row.get("media_assets")
        if isinstance(asset, list):
            asset = asset[0] if asset else None
        if asset and asset.get("cloudinary_url"):
            urls.append(asset["cloudinary_url"])
    return urls
