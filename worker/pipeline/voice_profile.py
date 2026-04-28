"""Voice profile inference and prompt rendering.

Two clean halves:

* :func:`analyze_samples` — calls the LLM with a deterministic instruction to
  emit a structured :class:`VoiceProfile` JSON. Stochastic, expensive, validated.
* :func:`render_system_prompt` — pure Python, deterministic. Turns the JSON
  back into a system prompt string. Cheap, re-runnable as we improve the
  template, fully unit-testable without an LLM.

This split is the single most important property of this module: if we ever
improve the rendering template, we re-run :func:`render_system_prompt` against
the stored profile — no extra LLM cost, no asking the user again.
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from adapters.llm import generate

# ─── Schema ─────────────────────────────────────────────────────────────────


class LengthProfile(BaseModel):
    avg_words: int = Field(ge=0)
    p90_words: int = Field(ge=0)
    tends: Literal["short", "medium", "long"]


class StructureProfile(BaseModel):
    uses_line_breaks: bool
    uses_bullets: Literal["never", "occasional", "frequent"]
    uses_numbered_lists: bool
    paragraph_count_avg: int = Field(ge=1)


class ToneProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # JSON name is "register" (LLM emits this); Python attribute is "tone_register"
    # to avoid shadowing BaseModel.register on Pydantic v2.
    tone_register: Literal[
        "casual",
        "informal-professional",
        "formal-professional",
        "academic",
        "playful",
    ] = Field(alias="register", serialization_alias="register")
    uses_first_person: bool
    personal_anecdotes: Literal["never", "occasional", "frequent"]
    emoji_use: Literal["none", "sparing", "moderate", "heavy"]
    emoji_typical: list[str] = Field(default_factory=list, max_length=8)


class OpenersProfile(BaseModel):
    patterns: list[str] = Field(default_factory=list, max_length=5)
    examples: list[str] = Field(default_factory=list, max_length=3)


class ClosersProfile(BaseModel):
    patterns: list[str] = Field(default_factory=list, max_length=5)
    uses_hashtags: Literal["never", "rarely", "sometimes", "often"]


class VoiceProfile(BaseModel):
    schema_version: Literal[1] = 1
    samples_count: int = Field(ge=1)
    platform_mix: dict[str, int] = Field(default_factory=dict)
    length: LengthProfile
    structure: StructureProfile
    tone: ToneProfile
    openers: OpenersProfile
    closers: ClosersProfile
    topics: list[str] = Field(default_factory=list, max_length=5)
    avoid: list[str] = Field(default_factory=list, max_length=5)


# ─── Analyzer (LLM-backed) ──────────────────────────────────────────────────

_ANALYZER_SYSTEM = (
    "You are a writing-style analyst. You will be given several social media "
    "posts written by a single author. Your job is to infer their voice as a "
    "structured JSON object. You MUST return only valid JSON — no preamble, "
    "no markdown fences, no commentary. The JSON must conform to this schema:\n\n"
    "{\n"
    '  "schema_version": 1,\n'
    '  "samples_count": <int — number of samples you saw>,\n'
    '  "platform_mix": {"linkedin": <int>, "x": <int>},\n'
    '  "length": {\n'
    '    "avg_words": <int>,\n'
    '    "p90_words": <int>,\n'
    '    "tends": "short" | "medium" | "long"\n'
    "  },\n"
    '  "structure": {\n'
    '    "uses_line_breaks": <bool>,\n'
    '    "uses_bullets": "never" | "occasional" | "frequent",\n'
    '    "uses_numbered_lists": <bool>,\n'
    '    "paragraph_count_avg": <int >= 1>\n'
    "  },\n"
    '  "tone": {\n'
    '    "register": "casual" | "informal-professional" | "formal-professional" '
    '| "academic" | "playful",\n'
    '    "uses_first_person": <bool>,\n'
    '    "personal_anecdotes": "never" | "occasional" | "frequent",\n'
    '    "emoji_use": "none" | "sparing" | "moderate" | "heavy",\n'
    '    "emoji_typical": [<up to 8 emoji characters>]\n'
    "  },\n"
    '  "openers": {\n'
    '    "patterns": [<up to 5 short labels, e.g. "bold one-liner claim", '
    '"personal story hook">],\n'
    '    "examples": [<up to 3 short verbatim opening lines from the samples>]\n'
    "  },\n"
    '  "closers": {\n'
    '    "patterns": [<up to 5 short labels>],\n'
    '    "uses_hashtags": "never" | "rarely" | "sometimes" | "often"\n'
    "  },\n"
    '  "topics": [<up to 5 short topic clusters the author writes about>],\n'
    '  "avoid": [<up to 5 phrases or patterns the author noticeably never uses>]\n'
    "}\n\n"
    "Rules: be specific (NOT 'professional tone' — say 'informal-professional, "
    "uses contractions, occasional self-deprecation'). Length tendency is 'short' "
    "if avg < 60 words, 'long' if avg > 200 words, otherwise 'medium'. Round "
    "ints. If a field cannot be inferred from the samples, use a reasonable "
    "default that errs toward neutral."
)


_MAX_SAMPLE_CHARS = 3000
_MAX_SAMPLES = 15


def _format_samples(samples: list[str]) -> str:
    """Build the user message body. Cap each sample length defensively."""
    capped = samples[:_MAX_SAMPLES]
    parts = []
    for i, sample in enumerate(capped, 1):
        text = sample.strip()[:_MAX_SAMPLE_CHARS]
        parts.append(f"--- Sample {i} ---\n{text}")
    return "\n\n".join(parts)


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _extract_json(raw: str) -> dict:
    """Tolerate the LLM occasionally wrapping JSON in code fences."""
    cleaned = _FENCE_RE.sub("", raw.strip()).strip()
    # If there is leading prose, slice from the first '{' to last '}'.
    if not cleaned.startswith("{"):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("LLM response did not contain a JSON object")
        cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


async def analyze_samples(
    samples: list[str], platform_hints: dict[str, int] | None = None
) -> VoiceProfile:
    """Infer a :class:`VoiceProfile` from the user's pasted posts.

    Raises :class:`ValueError` (re-raised by callers as 422) if the LLM output
    cannot be parsed or fails validation. We deliberately do NOT swallow
    parse errors — silent fallbacks would mean writing garbage into the DB.
    """
    if not samples:
        raise ValueError("at least one sample is required")

    user_message = _format_samples(samples)
    raw = await generate(
        system_prompt=_ANALYZER_SYSTEM,
        user_message=user_message,
    )

    try:
        payload = _extract_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"voice analyzer returned malformed JSON: {exc}") from exc

    # Backfill samples_count / platform_mix from the call site so a stray
    # LLM-counted sample doesn't disagree with what we actually sent.
    payload["samples_count"] = len(samples[:_MAX_SAMPLES])
    if platform_hints is not None:
        payload["platform_mix"] = platform_hints

    try:
        return VoiceProfile(**payload)
    except ValidationError as exc:
        raise ValueError(f"voice profile failed validation: {exc}") from exc


# ─── Renderer (pure Python) ─────────────────────────────────────────────────


def _length_phrase(length: LengthProfile) -> str:
    return {
        "short": f"Keep posts short — typically around {length.avg_words} words.",
        "medium": f"Aim for medium-length posts — around {length.avg_words} words.",
        "long": f"Write longer, in-depth posts — around {length.avg_words} words.",
    }[length.tends]


def _structure_phrase(s: StructureProfile) -> str:
    parts = []
    if s.uses_line_breaks:
        parts.append("use generous line breaks for readability")
    else:
        parts.append("write in flowing paragraphs without aggressive line breaks")
    if s.uses_bullets == "frequent":
        parts.append("use bullet points often")
    elif s.uses_bullets == "occasional":
        parts.append("use bullet points sparingly")
    else:
        parts.append("avoid bullet points")
    if s.uses_numbered_lists:
        parts.append("numbered lists are fine when the content is sequential")
    parts.append(f"average around {s.paragraph_count_avg} paragraph(s) per post")
    return ". ".join(p[0].upper() + p[1:] for p in parts) + "."


def _tone_phrase(t: ToneProfile) -> str:
    register_map = {
        "casual": "Casual, conversational register",
        "informal-professional": "Informal-professional register — friendly but credible",
        "formal-professional": "Formal-professional register — measured and precise",
        "academic": "Academic register — careful claims, qualified language",
        "playful": "Playful, witty register",
    }
    parts = [register_map[t.tone_register]]
    if t.uses_first_person:
        parts.append("write in first person")
    else:
        parts.append("avoid first-person voice")
    if t.personal_anecdotes == "frequent":
        parts.append("personal anecdotes and stories are a core part of the voice")
    elif t.personal_anecdotes == "occasional":
        parts.append("occasional personal anecdotes are welcome")
    else:
        parts.append("avoid personal anecdotes")
    emoji_map = {
        "none": "no emojis",
        "sparing": "at most one or two emojis per post",
        "moderate": "a few emojis where they add warmth",
        "heavy": "frequent use of emojis",
    }
    emoji_phrase = emoji_map[t.emoji_use]
    if t.emoji_use != "none" and t.emoji_typical:
        emoji_phrase += f" — favor {' '.join(t.emoji_typical[:4])}"
    parts.append(emoji_phrase)
    return ". ".join(p[0].upper() + p[1:] for p in parts) + "."


def _opener_phrase(o: OpenersProfile) -> str:
    if not o.patterns and not o.examples:
        return ""
    bits = []
    if o.patterns:
        bits.append("Open with: " + "; ".join(o.patterns[:3]) + ".")
    if o.examples:
        sample_list = "\n".join(f'  - "{ex}"' for ex in o.examples[:3])
        bits.append("Example openings the user has written:\n" + sample_list)
    return "\n".join(bits)


def _closer_phrase(c: ClosersProfile) -> str:
    bits = []
    if c.patterns:
        bits.append("Close with: " + "; ".join(c.patterns[:3]) + ".")
    hashtag_map = {
        "never": "Never use hashtags.",
        "rarely": "Hashtags only when truly relevant — usually skip them.",
        "sometimes": "A small number of focused hashtags are fine.",
        "often": "Hashtags are part of the voice — include 2-4 relevant ones.",
    }
    bits.append(hashtag_map[c.uses_hashtags])
    return " ".join(bits)


def _topics_phrase(topics: list[str]) -> str:
    if not topics:
        return ""
    return "Topics this author gravitates toward: " + ", ".join(topics[:5]) + "."


def _avoid_phrase(avoid: list[str]) -> str:
    if not avoid:
        return ""
    return "Avoid these patterns the author never uses: " + ", ".join(avoid[:5]) + "."


def render_system_prompt(
    profile: VoiceProfile,
    *,
    brand_name: str,
    tone_tags: list[str] | None = None,
) -> str:
    """Render the structured profile into a system prompt string.

    Pure function. No LLM call. Deterministic. If we improve the prompt
    template later, we re-run this against the stored ``voice_profile`` JSON
    to mint a new ``prompt_versions`` row — no extra LLM cost.
    """
    tone_tags = tone_tags or []
    sections: list[str] = []

    sections.append(
        f"You are a social media writer producing posts on behalf of "
        f"{brand_name}. Write in the author's own voice — not a generic "
        "social media voice. The voice profile below was inferred from posts "
        "the author has actually written; treat it as ground truth."
    )

    if tone_tags:
        sections.append(
            "User-tagged tone keywords: " + ", ".join(tone_tags) + "."
        )

    sections.append("LENGTH AND STRUCTURE\n" + _length_phrase(profile.length))
    sections.append(_structure_phrase(profile.structure))

    sections.append("TONE\n" + _tone_phrase(profile.tone))

    opener = _opener_phrase(profile.openers)
    if opener:
        sections.append("OPENINGS\n" + opener)

    closer = _closer_phrase(profile.closers)
    if closer:
        sections.append("CLOSINGS\n" + closer)

    topics = _topics_phrase(profile.topics)
    if topics:
        sections.append(topics)

    avoid = _avoid_phrase(profile.avoid)
    if avoid:
        sections.append(avoid)

    sections.append(
        "When given source material to write about, transform it into a post "
        "that follows every constraint above. If a constraint conflicts with "
        "the source's natural fit (e.g. the source is sequential but the "
        "voice is anti-bullet-points), favor the voice — that is what makes "
        "the post sound like the author."
    )

    return "\n\n".join(sections)
