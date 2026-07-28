import asyncio
import time

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

# ── Circuit breaker ────────────────────────────────────────────────────────
# After 3 consecutive Groq failures, skip Groq entirely for 60 seconds and go
# straight to Gemini. Resets on the first Groq success after the cooldown.
_groq_consecutive_failures = 0
_groq_open_until: float = 0  # monotonic timestamp


def _circuit_is_open() -> bool:
    return _groq_consecutive_failures >= 3 and time.monotonic() < _groq_open_until


def _record_groq_success() -> None:
    global _groq_consecutive_failures
    _groq_consecutive_failures = 0


def _record_groq_failure() -> None:
    global _groq_consecutive_failures, _groq_open_until
    _groq_consecutive_failures += 1
    if _groq_consecutive_failures >= 3:
        _groq_open_until = time.monotonic() + 60
        logger.warning(
            "groq_circuit_opened",
            consecutive_failures=_groq_consecutive_failures,
            cooldown_s=60,
        )


async def generate(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 1024,
    timeout: float = 30,
) -> str:
    """Call Groq; fall back to Gemini on any exception. Bounded by a global
    semaphore so concurrent callers can't exceed the provider rate limit.

    max_tokens defaults to 1024 (short single posts). Callers that need a large
    structured output — e.g. atomize's full JSON idea list — must raise it, or
    the response truncates into invalid JSON.

    timeout is passed to the underlying HTTP call. Callers can tune per use-case
    (atomize gets 60s, single-post generation gets 30s)."""
    async with _LLM_SEMAPHORE:
        if not _circuit_is_open():
            try:
                result = await groq_generate(
                    system_prompt,
                    user_message,
                    max_tokens=max_tokens,
                    timeout=timeout,
                )
                _record_groq_success()
                return result
            except Exception as exc:
                _record_groq_failure()
                logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
        else:
            logger.info("groq_circuit_open_skipping_to_gemini")

        try:
            return await gemini_generate(system_prompt, user_message, max_tokens=max_tokens)
        except Exception as gemini_exc:
            logger.error("gemini_also_failed", error=str(gemini_exc))
            raise HTTPException(
                status_code=502,
                detail="Both primary and fallback AI models failed to "
                "generate a response. Please try again later.",
            )
