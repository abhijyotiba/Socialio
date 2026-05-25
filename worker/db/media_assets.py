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
