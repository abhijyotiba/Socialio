from adapters.llm import generate

_PLATFORM_HINTS: dict[str, str] = {
    "linkedin": (
        "LinkedIn post (professional tone, 150–300 words, use line breaks for "
        "readability, may use 2–3 relevant emojis, end with a question or call-to-action)"
    ),
    "x": (
        "X/Twitter post (punchy, under 280 characters, conversational, "
        "no hashtag stuffing — at most 1–2 relevant hashtags)"
    ),
}


def _build_user_message(
    platform_hint: str,
    summary: str,
    user_angle: str | None,
) -> str:
    """
    Three modes, in order of branch:
      1. Summary + user_angle  → write to the angle, grounded in the summary
      2. Summary only          → write about the summary (today's behaviour)
      3. user_angle only       → write about the angle (prompt-only flow)
    """
    closing = "Return only the post text — no labels, no quotation marks."

    angle = (user_angle or "").strip()
    has_summary = bool(summary.strip())

    if has_summary and angle:
        return (
            f"Write a {platform_hint}.\n\n"
            f"User's angle / instruction:\n{angle}\n\n"
            f"Source material summary:\n{summary}\n\n"
            f"Follow the user's angle while staying truthful to the source. {closing}"
        )
    if has_summary:
        return (
            f"Write a {platform_hint} based on the following content summary.\n\n"
            f"Content summary:\n{summary}\n\n{closing}"
        )
    # Prompt-only — angle is the topic.
    return (
        f"Write a {platform_hint} about the following topic.\n\n"
        f"Topic:\n{angle}\n\n{closing}"
    )


async def generate_variants(
    summary: str,
    brand_system_prompt: str,
    platforms: list[str],
    user_angle: str | None = None,
) -> list[dict[str, str]]:
    if not summary.strip() and not (user_angle or "").strip():
        raise ValueError(
            "generate_variants requires either a content summary or a user_angle"
        )
    results = []
    for platform in platforms:
        hint = _PLATFORM_HINTS.get(platform, platform)
        user_message = _build_user_message(hint, summary, user_angle)
        body = await generate(system_prompt=brand_system_prompt, user_message=user_message)
        results.append({"platform": platform, "body": body.strip()})
    return results


_FORMAT_HINTS: dict[str, str] = {
    "hot_take": "a bold, opinionated hot take",
    "how_to": "a practical step-by-step how-to",
    "personal_story": "a short first-person story with a lesson",
    "question": "an engaging question that invites replies",
    "myth_buster": "a myth-vs-reality correction",
    "thread": "a multi-point thread (numbered points)",
}

_ANGLE_HINTS: dict[str, str] = {
    "beginner": "for an audience new to the topic",
    "expert": "for an experienced, expert audience",
    "contrarian": "taking a contrarian stance against common wisdom",
    "practical": "focused on practical, immediately actionable value",
}


async def render_cell(
    essence: str,
    source_quote: str,
    fmt: str,
    angle: str,
    platform: str,
    brand_system_prompt: str,
) -> str:
    """Stage B — render ONE matrix cell into a finished post body."""
    if not essence.strip():
        raise ValueError("render_cell requires an idea essence")

    platform_hint = _PLATFORM_HINTS.get(platform, platform)
    format_hint = _FORMAT_HINTS.get(fmt, fmt)
    angle_hint = _ANGLE_HINTS.get(angle, angle)

    user_message = (
        f"Write a {platform_hint}.\n\n"
        f"Form: write it as {format_hint} ({fmt}).\n"
        f"Angle: {angle_hint} ({angle}).\n\n"
        f"Express this single idea:\n{essence}\n\n"
        f"Stay truthful to this source quote (do not invent facts):\n{source_quote}\n\n"
        "Return only the post text — no labels, no quotation marks."
    )
    body = await generate(system_prompt=brand_system_prompt, user_message=user_message)
    return body.strip()
