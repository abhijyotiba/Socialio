"""Regenerate a single post variant according to a user instruction.

Conceptually a sibling of :mod:`pipeline.generate`, but built around editing
an existing draft rather than producing a fresh one. The brand system prompt
still controls voice; the instruction controls what to change.
"""

from adapters.llm import generate
from config import settings

_PLATFORM_HINTS: dict[str, str] = {
    "linkedin": (
        "LinkedIn post (professional tone, 150-300 words, line breaks for "
        "readability, may use 2-3 relevant emojis, ends with a question or "
        "call-to-action)"
    ),
    "x": (
        "X/Twitter post (punchy, under 280 characters, conversational, at most "
        "1-2 relevant hashtags)"
    ),
}


def _build_user_message(
    *,
    platform: str,
    current_body: str,
    instruction: str,
    summary: str | None,
) -> str:
    hint = _PLATFORM_HINTS.get(platform, platform)
    parts = [
        f"You are revising an existing {hint}.",
        "",
        "CURRENT POST:",
        current_body.strip(),
        "",
        f"USER INSTRUCTION: {instruction.strip()}",
    ]
    if summary:
        parts.extend(
            [
                "",
                "ORIGINAL SOURCE SUMMARY (for grounding — do NOT add facts that aren't here):",
                summary.strip(),
            ]
        )
    parts.extend(
        [
            "",
            "Return ONLY the revised post text. No labels, no commentary, no quotation marks. "
            "Preserve the author's voice from the system prompt. If the instruction would "
            "require inventing facts that aren't in the source summary, write the revision "
            "around what IS in the summary rather than fabricating numbers or quotes.",
        ]
    )
    return "\n".join(parts)


async def regenerate_variant(
    *,
    platform: str,
    current_body: str,
    instruction: str,
    brand_system_prompt: str,
    summary: str | None = None,
) -> str:
    """Return the revised body. Caller persists the snapshot + new body."""
    user_message = _build_user_message(
        platform=platform,
        current_body=current_body,
        instruction=instruction,
        summary=summary,
    )
    body = await generate(
        system_prompt=brand_system_prompt,
        user_message=user_message,
        timeout=settings.llm_timeout_generate_s,
    )
    return body.strip()
