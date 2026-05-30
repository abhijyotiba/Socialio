import asyncio

import structlog
from fastapi import HTTPException

from adapters.groq import groq_generate
from adapters.gemini import gemini_generate
from config import settings

logger = structlog.get_logger()

# Process-wide cap on concurrent LLM calls. The atomization matrix can issue
# many calls at once (refill cron batch); this queues them instead of blowing
# the provider's per-key rate limit. Created once at import, shared by all
# coroutines in this worker process.
_LLM_SEMAPHORE = asyncio.Semaphore(settings.llm_max_concurrency)


async def generate(
    system_prompt: str, user_message: str, max_tokens: int = 1024
) -> str:
    """Call Groq; fall back to Gemini on any exception. Bounded by a global
    semaphore so concurrent callers can't exceed the provider rate limit.

    max_tokens defaults to 1024 (short single posts). Callers that need a large
    structured output — e.g. atomize's full JSON idea list — must raise it, or
    the response truncates into invalid JSON."""
    async with _LLM_SEMAPHORE:
        try:
            return await groq_generate(system_prompt, user_message, max_tokens=max_tokens)
        except Exception as exc:
            logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
            try:
                return await gemini_generate(system_prompt, user_message, max_tokens=max_tokens)
            except Exception as gemini_exc:
                logger.error("gemini_also_failed", error=str(gemini_exc))
                raise HTTPException(
                    status_code=502,
                    detail="Both primary and fallback AI models failed to generate a response. Please try again later."
                )
