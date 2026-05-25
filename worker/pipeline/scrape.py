import asyncio
import ipaddress
import re
import socket
import sys
import time
from urllib.parse import urlparse

import httpx
import structlog
from playwright.async_api import async_playwright

from adapters import firecrawl
from config import settings

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

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

_CHALLENGE_TITLES = (
    "just a moment",
    "attention required",
    "access denied",
    "please wait",
    "checking your browser",
    "ddos-guard",
    "one more step",
)
_CHALLENGE_BODY_MARKERS = (
    "cf_chl_opt",
    "cf-browser-verification",
    "challenge-platform",
    "/cdn-cgi/challenge-platform/",
    "__cf_chl_",
)


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


def _looks_like_challenge(html: str, status_code: int | None = None) -> bool:
    if status_code in (403, 429, 503):
        return True
    if not html:
        return True
    sample = html[:8000].lower()
    title_match = re.search(r"<title[^>]*>(.*?)</title>", sample, re.DOTALL)
    if title_match:
        title = title_match.group(1).strip()
        if any(marker in title for marker in _CHALLENGE_TITLES):
            return True
    if any(marker in sample for marker in _CHALLENGE_BODY_MARKERS):
        return True
    # Suspiciously thin body — Cloudflare interstitials are tiny.
    if len(html) < 1500 and "challenge" in sample:
        return True
    return False


async def _fetch_html_httpx(url: str) -> str:
    timeout_s = max(settings.playwright_timeout_ms / 1000, 1)
    t0 = time.monotonic()
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=timeout_s,
        headers=_BROWSER_HEADERS,
    ) as client:
        response = await client.get(url)
        duration_ms = int((time.monotonic() - t0) * 1000)
        if response.status_code >= 400 and not response.text.strip():
            log.warning(
                "httpx_http_error",
                url=url,
                status=response.status_code,
                duration_ms=duration_ms,
            )
            raise ScrapeError(
                f"Source could not be fetched (HTTP {response.status_code})"
            )
        if _looks_like_challenge(response.text, response.status_code):
            log.warning(
                "httpx_challenge_detected",
                url=url,
                status=response.status_code,
                duration_ms=duration_ms,
                html_bytes=len(response.text),
            )
            raise ScrapeError("blocked-by-challenge")
        log.info(
            "httpx_success",
            url=url,
            status=response.status_code,
            duration_ms=duration_ms,
            html_bytes=len(response.text),
        )
        return response.text


async def _fetch_html_playwright(url: str) -> str:
    t0 = time.monotonic()
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=["--no-sandbox", "--disable-extensions"]
        )
        try:
            context = await browser.new_context(
                user_agent=_BROWSER_HEADERS["User-Agent"],
                locale="en-US",
            )
            page = await context.new_page()
            response = await page.goto(
                url,
                timeout=settings.playwright_timeout_ms,
                wait_until="domcontentloaded",
            )
            html = await page.content()
            status = response.status if response else None
            duration_ms = int((time.monotonic() - t0) * 1000)
            if _looks_like_challenge(html, status):
                log.warning(
                    "playwright_challenge_detected",
                    url=url,
                    status=status,
                    duration_ms=duration_ms,
                    html_bytes=len(html),
                )
                raise ScrapeError("blocked-by-challenge")
            log.info(
                "playwright_success",
                url=url,
                status=status,
                duration_ms=duration_ms,
                html_bytes=len(html),
            )
            return html
        finally:
            await browser.close()


async def fetch_html(url: str) -> str:
    host = urlparse(url).hostname or "?"
    log.info("scrape_start", url=url, host=host)

    if not await _is_ssrf_safe(url):
        log.warning("scrape_ssrf_blocked", url=url, host=host)
        raise ScrapeError(f"SSRF guard: {url} resolves to a private address")

    # On Windows under uvicorn --reload, the SelectorEventLoop is forced and
    # Playwright's subprocess support breaks. Skip straight to HTTPX in that case.
    try:
        loop = asyncio.get_running_loop()
        is_selector_on_windows = sys.platform == "win32" and isinstance(
            loop, asyncio.SelectorEventLoop
        )
    except Exception:
        is_selector_on_windows = False

    local_error: Exception | None = None
    local_path: str = ""

    if is_selector_on_windows:
        local_path = "httpx"
        log.info(
            "scrape_local_attempt",
            url=url,
            host=host,
            strategy="httpx",
            reason="selector_event_loop_on_windows",
        )
        try:
            return await _fetch_html_httpx(url)
        except ScrapeError as exc:
            local_error = exc
    else:
        local_path = "playwright"
        log.info("scrape_local_attempt", url=url, host=host, strategy="playwright")
        try:
            return await _fetch_html_playwright(url)
        except ScrapeError as exc:
            local_error = exc
        except NotImplementedError as exc:
            log.warning(
                "playwright_not_implemented_fallback_httpx",
                url=url,
                host=host,
                error=str(exc),
            )
            local_path = "httpx"
            try:
                return await _fetch_html_httpx(url)
            except ScrapeError as exc2:
                local_error = exc2
        except Exception as exc:
            log.error(
                "playwright_unexpected_error",
                url=url,
                host=host,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            local_error = exc

    # Local path failed or was blocked. Try Firecrawl as a paid, JS-rendering fallback.
    log.warning(
        "scrape_local_failed_trying_firecrawl",
        url=url,
        host=host,
        local_strategy=local_path,
        local_error=str(local_error) if local_error else None,
    )
    try:
        html = await firecrawl.scrape_html(url)
        if _looks_like_challenge(html):
            log.warning(
                "firecrawl_returned_challenge",
                url=url,
                host=host,
                html_bytes=len(html),
            )
            raise ScrapeError(
                "Source is protected and could not be read. Try pasting the text directly."
            )
        log.info("scrape_succeeded_via_firecrawl", url=url, host=host)
        return html
    except firecrawl.FirecrawlNotConfigured:
        log.error(
            "firecrawl_not_configured",
            url=url,
            host=host,
            hint="set FIRECRAWL_API_KEY in worker env",
        )
        raise ScrapeError(
            "Source appears to block automated readers and no fallback crawler is "
            "configured. Try pasting the article text instead."
        ) from local_error
    except firecrawl.FirecrawlQuotaError:
        raise ScrapeError(
            "Fallback crawler quota is exhausted for the month. Try pasting the "
            "article text instead."
        ) from local_error
    except firecrawl.FirecrawlError as exc:
        raise ScrapeError(
            f"Could not extract content from the source ({exc}). Try pasting the "
            "article text instead."
        ) from local_error
