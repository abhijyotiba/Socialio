import ipaddress
import socket
from urllib.parse import urlparse

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
        raise ValueError(f"SSRF guard: {url} resolves to a private address")
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
