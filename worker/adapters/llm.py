import asyncio
import time
from dataclasses import dataclass, field

import structlog
from fastapi import HTTPException
from supabase import AsyncClient

from adapters._types import GenerateResult
from adapters.groq import groq_generate
from adapters.gemini import gemini_generate
from config import settings
from observability.metrics import incr, observe

logger = structlog.get_logger()

# Process-wide cap on concurrent LLM calls.
_LLM_SEMAPHORE = asyncio.Semaphore(settings.llm_max_concurrency)

# ── Circuit breaker ────────────────────────────────────────────────────────
_groq_consecutive_failures = 0
_groq_open_until: float = 0


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


# ── Cost model (USD per 1M tokens, approximate) ────────────────────────────
_COST_PER_1M = {
    ("groq", "llama-3.3-70b-versatile"): (0.59, 0.79),   # prompt, output
    ("gemini", "gemini-1.5-flash"):       (0.075, 0.30),
    ("gemini", "gemini-2.0-flash"):       (0.10, 0.40),
}


def _estimate_cost(provider: str, model: str, prompt_tokens: int, output_tokens: int) -> float:
    costs = _COST_PER_1M.get((provider, model), (0, 0))
    prompt_cost = costs[0] * (prompt_tokens / 1_000_000)
    output_cost = (costs[1] if len(costs) > 1 else costs[0]) * (output_tokens / 1_000_000)
    return round(prompt_cost + output_cost, 8)


async def generate(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 1024,
    timeout: float = 30,
    *,
    workspace_id: str = "",
    call_type: str = "",
    svc: AsyncClient | None = None,
) -> str:
    """Call Groq; fall back to Gemini on any exception. Records metrics and
    cost tracking when `workspace_id` + `call_type` + `svc` are all provided.

    max_tokens defaults to 1024 (short single posts). Callers needing large
    structured output — e.g. atomize — must raise it.

    timeout is the per-call HTTP timeout. Callers tune per use-case
    (atomize 60s, generate/summarize 30s)."""
    t0 = time.monotonic()
    provider = settings.groq_model
    used_groq = True

    async with _LLM_SEMAPHORE:
        result: GenerateResult | None = None
        if not _circuit_is_open():
            try:
                result = await groq_generate(
                    system_prompt, user_message,
                    max_tokens=max_tokens, timeout=timeout,
                )
                _record_groq_success()
            except Exception as exc:
                _record_groq_failure()
                logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
        else:
            logger.info("groq_circuit_open_skipping_to_gemini")

        if result is None:
            try:
                result = await gemini_generate(system_prompt, user_message, max_tokens=max_tokens)
                provider = settings.gemini_model
                used_groq = False
            except Exception as gemini_exc:
                logger.error("gemini_also_failed", error=str(gemini_exc))
                incr("llm.call.failed")
                raise HTTPException(
                    status_code=502,
                    detail="Both primary and fallback AI models failed.",
                )

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    # ── Metrics ─────────────────────────────────────────────────────────
    provider_name = "groq" if used_groq else "gemini"
    incr(f"llm.call.{provider_name}.ok")
    observe(f"llm.call.{provider_name}.latency_ms", elapsed_ms)

    # ── Cost tracking (fire-and-forget) ──────────────────────────────────
    if workspace_id and call_type and svc:
        from db.llm_usage import record_usage

        cost = _estimate_cost(provider_name, provider, result.prompt_tokens, result.output_tokens)
        await record_usage(
            svc,
            workspace_id=workspace_id,
            provider=provider_name,
            model=provider,
            call_type=call_type,
            prompt_tokens=result.prompt_tokens,
            output_tokens=result.output_tokens,
            cost_usd=cost,
            duration_ms=elapsed_ms,
        )

    return result.body
