import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

_STRIP_TAGS = {"nav", "header", "footer", "script", "style", "noscript", "aside"}
_MAX_MEDIA = 5


@dataclass
class ExtractedContent:
    title: str
    text: str
    media_urls: list[str] = field(default_factory=list)


def parse(html: str, base_url: str = "") -> ExtractedContent:
    soup = BeautifulSoup(html, "lxml")

    title = _extract_title(soup)
    text = _extract_text(soup)
    media_urls = _extract_media(soup, base_url)

    return ExtractedContent(title=title, text=text, media_urls=media_urls)


def _extract_title(soup: BeautifulSoup) -> str:
    og = soup.find("meta", property="og:title")
    if og and isinstance(og, Tag):
        val = og.get("content", "")
        if val:
            return str(val).strip()

    title_tag = soup.find("title")
    if title_tag:
        text = title_tag.get_text().strip()
        if text:
            return text

    h1 = soup.find("h1")
    if h1:
        text = h1.get_text().strip()
        if text:
            return text

    return ""


def _extract_text(soup: BeautifulSoup) -> str:
    for tag in soup.find_all(_STRIP_TAGS):
        tag.decompose()

    body = soup.find("article") or soup.find("main") or soup.body
    if not body:
        return ""

    raw = body.get_text(separator=" ")
    # collapse whitespace
    return re.sub(r"\s+", " ", raw).strip()


def _extract_media(soup: BeautifulSoup, base_url: str) -> list[str]:
    urls: list[str] = []

    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and str(src).startswith("http"):
            urls.append(str(src))

    for img in soup.find_all("img"):
        if len(urls) >= _MAX_MEDIA:
            break
        if not isinstance(img, Tag):
            continue
        src = img.get("src", "")
        if not src:
            continue
        abs_src = urljoin(base_url, str(src)) if base_url else str(src)
        if abs_src.startswith("http") and abs_src not in urls:
            urls.append(abs_src)

    return urls[:_MAX_MEDIA]
