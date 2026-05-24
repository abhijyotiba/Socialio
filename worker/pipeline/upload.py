import asyncio
import time

import structlog

import cloudinary
import cloudinary.uploader

from config import settings

log = structlog.get_logger()

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
)


async def _upload_one(url: str, workspace_id: str) -> dict | None:
    t0 = time.monotonic()
    try:
        r = await asyncio.to_thread(
            cloudinary.uploader.upload,
            url,
            folder=f"socialos/{workspace_id}/",
            resource_type="auto",
        )
    except Exception as e:
        log.warning(
            "cloudinary_upload_failed",
            url=url,
            error=str(e),
            duration_ms=int((time.monotonic() - t0) * 1000),
        )
        return None

    log.info(
        "cloudinary_upload_success",
        url=url,
        duration_ms=int((time.monotonic() - t0) * 1000),
        bytes=r.get("bytes"),
        format=r.get("format"),
    )
    return {
        "cloudinary_url": r["secure_url"],
        "cloudinary_id": r["public_id"],
        "resource_type": r["resource_type"],
        "format": r.get("format"),
        "bytes": r.get("bytes"),
        "width": r.get("width"),
        "height": r.get("height"),
    }


async def to_cloudinary(media_urls: list[str], workspace_id: str) -> list[dict]:
    if not media_urls:
        return []

    t0 = time.monotonic()
    outcomes = await asyncio.gather(
        *(_upload_one(url, workspace_id) for url in media_urls)
    )
    results = [r for r in outcomes if r is not None]
    log.info(
        "cloudinary_batch_done",
        requested=len(media_urls),
        succeeded=len(results),
        failed=len(media_urls) - len(results),
        duration_ms=int((time.monotonic() - t0) * 1000),
    )
    return results
