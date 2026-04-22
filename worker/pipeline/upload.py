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


async def to_cloudinary(media_urls: list[str], workspace_id: str) -> list[dict]:
    results = []
    for url in media_urls:
        try:
            r = cloudinary.uploader.upload(
                url,
                folder=f"socialos/{workspace_id}/",
                resource_type="auto",
            )
            results.append(
                {
                    "cloudinary_url": r["secure_url"],
                    "cloudinary_id": r["public_id"],
                    "resource_type": r["resource_type"],
                    "format": r.get("format"),
                    "bytes": r.get("bytes"),
                    "width": r.get("width"),
                    "height": r.get("height"),
                }
            )
        except Exception as e:
            log.warning("cloudinary_upload_failed", url=url, error=str(e))
    return results
