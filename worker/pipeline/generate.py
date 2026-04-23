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


async def generate_variants(
    summary: str,
    brand_system_prompt: str,
    platforms: list[str],
) -> list[dict[str, str]]:
    results = []
    for platform in platforms:
        hint = _PLATFORM_HINTS.get(platform, platform)
        user_message = (
            f"Write a {hint} based on the following content summary.\n\n"
            f"Content summary:\n{summary}\n\n"
            "Return only the post text — no labels, no quotation marks."
        )
        body = await generate(system_prompt=brand_system_prompt, user_message=user_message)
        results.append({"platform": platform, "body": body.strip()})
    return results
