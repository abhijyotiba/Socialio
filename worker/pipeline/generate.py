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


def _build_brief_guidance(brief: dict | None) -> str:
    """Render a structured campaign brief (Task 6) into prompt guidance.

    Returns an empty string when there's no brief, so callers can prepend it
    unconditionally. `goal`/`core_message` frame the post up front; `tone`,
    do/don't lists, and `cta` steer the style and close.
    """
    if not brief:
        return ""

    goal = (brief.get("goal") or "").strip()
    core_message = (brief.get("core_message") or "").strip()
    tone = (brief.get("tone") or "").strip()
    cta = (brief.get("cta") or "").strip()
    dos = [d.strip() for d in (brief.get("do") or []) if d and d.strip()]
    donts = [d.strip() for d in (brief.get("dont") or []) if d and d.strip()]

    parts: list[str] = []
    if goal:
        parts.append(f"Campaign goal: {goal}")
    if core_message:
        parts.append(f"Core message to land: {core_message}")
    if tone:
        parts.append(f"Tone: {tone}")
    if dos:
        parts.append("Do: " + "; ".join(dos))
    if donts:
        parts.append("Don't: " + "; ".join(donts))
    if cta:
        parts.append(f"Call to action: {cta}")

    if not parts:
        return ""
    return "Campaign brief:\n" + "\n".join(f"- {p}" for p in parts)


def _build_user_message(
    platform_hint: str,
    summary: str,
    user_angle: str | None,
    brief: dict | None = None,
) -> str:
    """
    Three modes, in order of branch:
      1. Summary + user_angle  → write to the angle, grounded in the summary
      2. Summary only          → write about the summary (today's behaviour)
      3. user_angle only       → write about the angle (prompt-only flow)

    When a structured `brief` (Task 6) is present, its goal/core_message/tone/
    do/don't/CTA guidance is prepended to whichever mode applies. `brief` is
    preferred over `user_angle`, so when a brief is supplied the free-text angle
    is not also injected (avoids conflicting instructions).
    """
    closing = "Return only the post text — no labels, no quotation marks."

    brief_guidance = _build_brief_guidance(brief)
    # A structured brief supersedes the free-text angle.
    angle = "" if brief_guidance else (user_angle or "").strip()
    has_summary = bool(summary.strip())

    prefix = f"{brief_guidance}\n\n" if brief_guidance else ""

    if brief_guidance and not has_summary and not angle:
        return (
            f"{prefix}"
            f"Write a {platform_hint} that delivers the campaign brief above.\n\n"
            f"{closing}"
        )
    if has_summary and brief_guidance:
        return (
            f"{prefix}"
            f"Write a {platform_hint} based on the following content summary, "
            f"following the campaign brief above.\n\n"
            f"Content summary:\n{summary}\n\n{closing}"
        )

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
    brief: dict | None = None,
) -> list[dict[str, str]]:
    if (
        not summary.strip()
        and not (user_angle or "").strip()
        and not _build_brief_guidance(brief)
    ):
        raise ValueError(
            "generate_variants requires a content summary, a user_angle, or a brief"
        )
    results = []
    for platform in platforms:
        hint = _PLATFORM_HINTS.get(platform, platform)
        user_message = _build_user_message(hint, summary, user_angle, brief)
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
