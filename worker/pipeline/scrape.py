import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import structlog

from adapters import firecrawl

log = structlog.get_logger()

_PRIVATE_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / AWS metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


class ScrapeError(Exception):
    pass


async def _is_ssrf_safe(url: str) -> bool:
    """DNS-based SSRF guard. String-matching is bypassable via decimal/octal IPs or redirects."""
    hostname = urlparse(url).hostname
    if not hostname:
        return False
    try:
        resolved_ip = await asyncio.to_thread(socket.gethostbyname, hostname)
        ip = ipaddress.ip_address(resolved_ip)
        return not any(ip in net for net in _PRIVATE_NETS)
    except (socket.gaierror, ValueError):
        return False


async def fetch_html(url: str) -> str:
    host = urlparse(url).hostname or "?"
    log.info("scrape_start", url=url, host=host)

    if not await _is_ssrf_safe(url):
        log.warning("scrape_ssrf_blocked", url=url, host=host)
        raise ScrapeError(f"SSRF guard: {url} resolves to a private address")

    try:
        html = await firecrawl.scrape_html(url)
    except firecrawl.FirecrawlNotConfigured as exc:
        log.error(
            "firecrawl_not_configured",
            url=url,
            host=host,
            hint="set FIRECRAWL_API_KEY in worker env",
        )
        raise ScrapeError(
            "URL scraping is not configured. Set FIRECRAWL_API_KEY or paste the "
            "article text directly."
        ) from exc
    except firecrawl.FirecrawlQuotaError as exc:
        raise ScrapeError(
            "Scraper quota is exhausted for the month. Try pasting the article "
            "text instead."
        ) from exc
    except firecrawl.FirecrawlError as exc:
        raise ScrapeError(
            f"Could not extract content from the source ({exc}). Try pasting the "
            "article text instead."
        ) from exc

    log.info("scrape_succeeded", url=url, host=host, html_bytes=len(html))
    return html
