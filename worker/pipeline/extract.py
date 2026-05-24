import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

_STRIP_TAGS = {"nav", "header", "footer", "script", "style", "noscript", "aside"}
_MAX_MEDIA = 5
_MIN_BODY_TEXT_LEN = 400


@dataclass
class ExtractedContent:
    title: str
    text: str
    media_urls: list[str] = field(default_factory=list)


def parse(html: str, base_url: str = "") -> ExtractedContent:
    soup = BeautifulSoup(html, "lxml")
    json_ld = _collect_json_ld(soup)

    title = _extract_title(soup, json_ld)
    text = _extract_text(soup, json_ld)
    media_urls = _extract_media(soup, base_url, json_ld)

    return ExtractedContent(title=title, text=text, media_urls=media_urls)


def _collect_json_ld(soup: BeautifulSoup) -> list[dict]:
    results: list[dict] = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.get_text() or "")
        except (ValueError, TypeError):
            continue
        if isinstance(data, list):
            results.extend(item for item in data if isinstance(item, dict))
        elif isinstance(data, dict):
            graph = data.get("@graph")
            if isinstance(graph, list):
                results.extend(item for item in graph if isinstance(item, dict))
            else:
                results.append(data)
    return results


def _json_ld_field(json_ld: list[dict], *keys: str) -> str:
    for item in json_ld:
        for key in keys:
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _extract_title(soup: BeautifulSoup, json_ld: list[dict]) -> str:
    ld_title = _json_ld_field(json_ld, "headline", "name")
    if ld_title:
        return ld_title

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


def _extract_text(soup: BeautifulSoup, json_ld: list[dict]) -> str:
    for tag in soup.find_all(_STRIP_TAGS):
        tag.decompose()

    body = soup.find("article") or soup.find("main") or soup.body
    text = ""
    if body:
        raw = body.get_text(separator=" ")
        text = re.sub(r"\s+", " ", raw).strip()

    if len(text) < _MIN_BODY_TEXT_LEN:
        ld_body = _json_ld_field(json_ld, "articleBody", "description")
        if len(ld_body) > len(text):
            text = re.sub(r"\s+", " ", ld_body).strip()

    return text


def _extract_media(
    soup: BeautifulSoup, base_url: str, json_ld: list[dict]
) -> list[str]:
    urls: list[str] = []

    for item in json_ld:
        image = item.get("image")
        candidates: list[str] = []
        if isinstance(image, str):
            candidates.append(image)
        elif isinstance(image, dict):
            url_val = image.get("url")
            if isinstance(url_val, str):
                candidates.append(url_val)
        elif isinstance(image, list):
            for entry in image:
                if isinstance(entry, str):
                    candidates.append(entry)
                elif isinstance(entry, dict) and isinstance(entry.get("url"), str):
                    candidates.append(entry["url"])
        for src in candidates:
            if src.startswith("http") and src not in urls:
                urls.append(src)
                if len(urls) >= _MAX_MEDIA:
                    return urls

    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and str(src).startswith("http") and str(src) not in urls:
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
