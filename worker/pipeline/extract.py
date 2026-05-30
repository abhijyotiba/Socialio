import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

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


_DUMMY_TITLE_KEYWORDS = {
    "recaptcha",
    "cloudflare",
    "security check",
    "robot check",
    "captcha",
    "hcaptcha",
    "checking your browser",
    "access denied",
    "just a moment",
    "ddos guard",
    "imperva",
    "sucuri",
}


def _is_dummy_title(title: str) -> bool:
    if not title:
        return True
    t_lower = title.lower()
    return any(kw in t_lower for kw in _DUMMY_TITLE_KEYWORDS)


def _extract_title(soup: BeautifulSoup, json_ld: list[dict]) -> str:
    ld_title = _json_ld_field(json_ld, "headline", "name")
    if ld_title and not _is_dummy_title(ld_title):
        return ld_title

    og = soup.find("meta", property="og:title")
    if og and isinstance(og, Tag):
        val = og.get("content", "")
        if val and not _is_dummy_title(str(val)):
            return str(val).strip()

    title_tag = soup.find("title")
    if title_tag:
        text = title_tag.get_text().strip()
        if text and not _is_dummy_title(text):
            return text

    h1 = soup.find("h1")
    if h1:
        text = h1.get_text().strip()
        if text and not _is_dummy_title(text):
            return text

    # Fallback to absolute last resort: first available title, even if dummy
    if ld_title:
        return ld_title
    if og and isinstance(og, Tag):
        val = og.get("content", "")
        if val:
            return str(val).strip()
    if title_tag:
        text = title_tag.get_text().strip()
        if text:
            return text
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


def _is_likely_junk_image(tag: Tag | None, src: str) -> bool:
    src_lower = src.lower()

    # 1. Dimension filters from tag attributes (if tag is provided)
    if tag:
        for attr in ("width", "height"):
            val = tag.get(attr)
            if val:
                try:
                    clean_val = re.sub(r"[^\d]", "", str(val))
                    if clean_val and int(clean_val) < 100:
                        return True
                except ValueError:
                    pass

    # 2. Check for small sizes in URL path (e.g. "32x32", "fill:32:32")
    size_patterns = [
        r"[^\d]16[x:-]16[^\d]",
        r"[^\d]32[x:-]32[^\d]",
        r"[^\d]48[x:-]48[^\d]",
        r"[^\d]64[x:-]64[^\d]",
    ]
    for pattern in size_patterns:
        if re.search(pattern, src_lower):
            return True

    # 3. Keyword blocklist for avatars/icons/pixels in URL or classes/IDs/alt-text
    junk_keywords = {
        "avatar", "logo", "icon", "pixel", "tracker", "spinner",
        "loading", "badge", "emoji", "sprite", "adzerk",
        "doubleclick", "analytics", "favicon"
    }

    url_path = urlparse(src).path.lower()
    if any(kw in url_path for kw in junk_keywords):
        return True

    if tag:
        classes = tag.get("class", [])
        if isinstance(classes, list):
            classes_str = " ".join(str(c) for c in classes).lower()
        else:
            classes_str = str(classes).lower()

        element_id = str(tag.get("id", "")).lower()
        alt_text = str(tag.get("alt", "")).lower()

        if any(kw in classes_str for kw in junk_keywords):
            return True
        if any(kw in element_id for kw in junk_keywords):
            return True

        avatar_alts = {"avatar", "profile picture", "author picture", "user photo", "go to the profile of"}
        if any(kw in alt_text for kw in avatar_alts):
            return True

    return False


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
                if not _is_likely_junk_image(None, src):
                    urls.append(src)
                    if len(urls) >= _MAX_MEDIA:
                        return urls

    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and str(src).startswith("http") and str(src) not in urls:
            if not _is_likely_junk_image(None, str(src)):
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
            if not _is_likely_junk_image(img, abs_src):
                urls.append(abs_src)

    return urls[:_MAX_MEDIA]
