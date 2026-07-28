import asyncio

import structlog
from groq import AsyncGroq, RateLimitError, APITimeoutError, InternalServerError

from adapters._types import GenerateResult
from config import get_settings

log = structlog.get_logger()

# Transient errors worth retrying — everything else (auth, content policy, etc.)
# should fail immediately and fall through to Gemini.
_RETRYABLE = (RateLimitError, APITimeoutError, InternalServerError)
_MAX_RETRIES = 2
_RETRY_BACKOFF_S = (1, 4)  # seconds between attempts


async def groq_generate(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 1024,
    timeout: float = 30,
) -> GenerateResult:
    """Call Groq with retry on transient errors. Returns body + token counts
    for cost tracking. Falls through to Gemini via llm.py on failure."""
    settings = get_settings()
    client = AsyncGroq(api_key=settings.groq_api_key)
    last_error: Exception | None = None

    for attempt in range(1 + _MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=settings.groq_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    max_tokens=max_tokens,
                    temperature=0.7,
                ),
                timeout=timeout,
            )
            usage = response.usage
            return GenerateResult(
                body=response.choices[0].message.content or "",
                prompt_tokens=usage.prompt_tokens if usage else 0,
                output_tokens=usage.completion_tokens if usage else 0,
            )
        except _RETRYABLE as exc:
            last_error = exc
            if attempt < _MAX_RETRIES:
                delay = _RETRY_BACKOFF_S[attempt]
                log.info(
                    "groq_retry",
                    attempt=attempt + 1,
                    delay_s=delay,
                    error=str(exc)[:200],
                )
                await asyncio.sleep(delay)
            else:
                log.warning(
                    "groq_retries_exhausted",
                    attempts=attempt + 1,
                    error=str(exc)[:200],
                )
        except Exception as exc:
            # Non-retryable error — fail immediately, caller falls back to Gemini.
            last_error = exc
            break

    raise last_error or RuntimeError("groq_generate failed with no captured error")
