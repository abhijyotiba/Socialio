"""Firecrawl v1 scrape adapter — used as fallback when local scraping is blocked."""

import time

import httpx
import structlog

from config import settings

log = structlog.get_logger()

_API_URL = "https://api.firecrawl.dev/v1/scrape"


class FirecrawlError(Exception):
    pass


class FirecrawlQuotaError(FirecrawlError):
    pass


class FirecrawlNotConfigured(FirecrawlError):
    pass


async def scrape_html(url: str) -> str:
    """Fetch a URL via Firecrawl and return the rendered HTML.

    Raises FirecrawlNotConfigured if no API key is set, FirecrawlQuotaError on
    402/429, FirecrawlError on any other failure.
    """
    if not settings.firecrawl_api_key:
        raise FirecrawlNotConfigured("FIRECRAWL_API_KEY is not set")

    payload = {
        "url": url,
        "formats": ["html"],
        "onlyMainContent": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.firecrawl_api_key}",
        "Content-Type": "application/json",
    }

    log.info("firecrawl_request_start", url=url)
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=settings.firecrawl_timeout_s) as client:
            response = await client.post(_API_URL, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        log.error(
            "firecrawl_transport_error",
            url=url,
            error=str(exc),
            duration_ms=int((time.monotonic() - t0) * 1000),
        )
        raise FirecrawlError(f"Firecrawl request failed: {exc}") from exc

    duration_ms = int((time.monotonic() - t0) * 1000)

    if response.status_code in (402, 429):
        log.warning(
            "firecrawl_quota_exhausted",
            url=url,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        raise FirecrawlQuotaError(
            f"Firecrawl quota exhausted (HTTP {response.status_code})"
        )
    if response.status_code >= 400:
        log.error(
            "firecrawl_http_error",
            url=url,
            status=response.status_code,
            duration_ms=duration_ms,
            body_preview=response.text[:200],
        )
        raise FirecrawlError(
            f"Firecrawl returned HTTP {response.status_code}: {response.text[:200]}"
        )

    body = response.json()
    if not body.get("success"):
        log.error(
            "firecrawl_api_error",
            url=url,
            error=body.get("error"),
            duration_ms=duration_ms,
        )
        raise FirecrawlError(f"Firecrawl error: {body.get('error', 'unknown')}")

    html = (body.get("data") or {}).get("html") or ""
    if not html.strip():
        log.error("firecrawl_empty_html", url=url, duration_ms=duration_ms)
        raise FirecrawlError("Firecrawl returned empty HTML")

    log.info(
        "firecrawl_success",
        url=url,
        duration_ms=duration_ms,
        html_bytes=len(html),
    )
    return html
