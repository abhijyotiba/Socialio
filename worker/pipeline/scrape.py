import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from playwright.async_api import async_playwright

from config import settings

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


def _is_ssrf_safe(url: str) -> bool:
    """DNS-based SSRF guard. String-matching is bypassable via decimal/octal IPs or redirects."""
    hostname = urlparse(url).hostname
    if not hostname:
        return False
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        return not any(ip in net for net in _PRIVATE_NETS)
    except (socket.gaierror, ValueError):
        return False


async def fetch_html(url: str) -> str:
    if not _is_ssrf_safe(url):
        raise ScrapeError(f"SSRF guard: {url} resolves to a private address")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                args=["--no-sandbox", "--disable-extensions"]
            )
            page = await browser.new_page()
            await page.goto(
                url,
                timeout=settings.playwright_timeout_ms,
                wait_until="domcontentloaded",
            )
            html = await page.content()
            await browser.close()
            return html
    except NotImplementedError:
        # Windows/Python event-loop subprocess incompatibility fallback.
        timeout_s = max(settings.playwright_timeout_ms / 1000, 1)
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout_s,
            headers={"User-Agent": "SocialOS-Worker/1.0"},
        ) as client:
            response = await client.get(url)
            if response.status_code >= 400 and not response.text.strip():
                raise ScrapeError(
                    f"Source could not be fetched (HTTP {response.status_code})"
                )
            return response.text
