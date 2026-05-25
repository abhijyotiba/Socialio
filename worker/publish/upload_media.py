import httpx
import structlog

from adapters import linkedin, x

log = structlog.get_logger()


def mime_type_from_url(url: str) -> str:
    ext = url.split("?")[0].split(".")[-1].lower()
    return {
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
    }.get(ext, "image/jpeg")


async def _fetch_image_bytes(url: str) -> bytes | None:
    """Returns None on failure (non-fatal — caller publishes text-only)."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            res = await client.get(url)
        if res.status_code >= 400:
            return None
        return res.content
    except Exception:  # noqa: BLE001 — non-fatal
        return None


async def upload_media_for_platform(
    platform: str,
    access_token: str,
    cloudinary_urls: list[str],
    author_urn: str | None = None,
) -> list[str]:
    """Uploads each asset to the target platform, returning platform media
    IDs/URNs. Failures are non-fatal — a failed asset is skipped."""
    ids: list[str] = []
    for url in cloudinary_urls:
        try:
            mime = mime_type_from_url(url)
            data = await _fetch_image_bytes(url)
            if not data:
                log.warning("media_fetch_failed", url=url)
                continue
            if platform == "linkedin":
                if not author_urn:
                    raise ValueError("author_urn required for LinkedIn")
                upload_url, asset_urn = await linkedin.register_upload(
                    access_token, author_urn, len(data)
                )
                await linkedin.upload_bytes(upload_url, data)
                ids.append(asset_urn)
            else:
                ids.append(await x.upload_media(access_token, data, mime))
        except Exception as exc:  # noqa: BLE001 — non-fatal, skip this asset
            log.warning("media_upload_failed", url=url, error=str(exc))
    return ids
