import structlog

from adapters.groq import groq_generate
from adapters.gemini import gemini_generate

logger = structlog.get_logger()


async def generate(system_prompt: str, user_message: str) -> str:
    """Call Groq; fall back to Gemini on any exception."""
    try:
        return await groq_generate(system_prompt, user_message)
    except Exception as exc:
        logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
        return await gemini_generate(system_prompt, user_message)
