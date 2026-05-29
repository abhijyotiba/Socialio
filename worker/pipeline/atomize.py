"""Stage A of the content engine — extract atomic ideas from an asset.

One structured-output LLM call mines the asset text into a JSON array of
ideas. Each idea is grounded in a verbatim source_quote (anti-fabrication
anchor) and tagged with the formats/angles it best suits, so the matrix only
expands sensible cells.
"""

import json
import re

from adapters.llm import generate
from pipeline.matrix import FORMATS, ANGLES, IDEA_TYPES

_MAX_TEXT = 12000

_SYSTEM = (
    "You extract atomic, reusable content ideas from source material for social "
    "media. Each idea must be a single self-contained insight grounded in a "
    "verbatim quote from the source. Never invent facts or statistics."
)


def _build_user_message(title: str, text: str) -> str:
    title_line = f"Title: {title}\n\n" if title.strip() else ""
    return (
        f"{title_line}Source material:\n{text[:_MAX_TEXT]}\n\n"
        "Extract every distinct, postable idea. Return ONLY a JSON array. Each "
        "element must be an object with these keys:\n"
        '  "essence": one-sentence statement of the idea\n'
        '  "idea_type": one of ' + ", ".join(IDEA_TYPES) + "\n"
        '  "source_quote": a verbatim snippet from the source that grounds it\n'
        '  "strength": integer 1-5, how strong/postable the idea is\n'
        '  "suitable_formats": subset of ' + ", ".join(FORMATS) + "\n"
        '  "suitable_angles": subset of ' + ", ".join(ANGLES) + "\n"
        "Return [] if there are no usable ideas. No prose, no code fence."
    )


def _strip_fence(raw: str) -> str:
    fenced = re.search(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL)
    if fenced:
        return fenced.group(1).strip()
    return raw.strip()


def _clean_idea(entry: object) -> dict | None:
    if not isinstance(entry, dict):
        return None
    essence = str(entry.get("essence") or "").strip()
    idea_type = str(entry.get("idea_type") or "").strip()
    source_quote = str(entry.get("source_quote") or "").strip()
    if not essence or not source_quote or idea_type not in IDEA_TYPES:
        return None
    try:
        strength = int(entry.get("strength", 3))
    except (TypeError, ValueError):
        strength = 3
    strength = max(1, min(5, strength))
    formats = [f for f in (entry.get("suitable_formats") or []) if f in FORMATS]
    angles = [a for a in (entry.get("suitable_angles") or []) if a in ANGLES]
    return {
        "essence": essence,
        "idea_type": idea_type,
        "source_quote": source_quote,
        "strength": strength,
        "suitable_formats": formats,
        "suitable_angles": angles,
    }


async def extract_ideas(
    title: str, text: str, brand_system_prompt: str
) -> list[dict]:
    if not text.strip():
        return []
    user_message = _build_user_message(title, text)
    # Brand voice steers which ideas matter, but the extraction contract is fixed.
    system_prompt = f"{_SYSTEM}\n\nBrand context:\n{brand_system_prompt}"
    raw = await generate(system_prompt=system_prompt, user_message=user_message)

    try:
        parsed = json.loads(_strip_fence(raw))
    except (ValueError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []

    cleaned = [c for c in (_clean_idea(e) for e in parsed) if c is not None]
    return cleaned
