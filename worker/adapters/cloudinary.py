import asyncio

import cloudinary
import cloudinary.uploader

from config import settings

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
)


async def delete_asset(public_id: str) -> None:
    """Delete a Cloudinary asset. Idempotent — a missing asset is not an error,
    so the cleanup cron can safely retry."""
    res = await asyncio.to_thread(cloudinary.uploader.destroy, public_id)
    if res.get("result") not in ("ok", "not found"):
        raise RuntimeError(f"Cloudinary delete failed: {res}")
