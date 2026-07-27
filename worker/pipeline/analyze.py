from adapters.llm import generate
from config import settings

_SYSTEM = (
    "You are a content analyst. Read the article below and extract the key points "
    "in 3-5 concise bullet points. Focus on the main message, notable facts, and "
    "angles that would make compelling social media posts. Return only the bullet "
    "points — no preamble, no headers."
)

_MAX_TEXT_CHARS = 8000


async def summarize(title: str, text: str) -> str:
    truncated = text[:_MAX_TEXT_CHARS]
    title_line = f"Title: {title}\n\n" if title else ""
    user_message = f"{title_line}Article:\n{truncated}"
    return await generate(
        system_prompt=_SYSTEM,
        user_message=user_message,
        timeout=settings.llm_timeout_summarize_s,
    )
