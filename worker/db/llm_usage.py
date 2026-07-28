"""Write-only LLM usage tracking. Insert is fire-and-forget — a failed
write to the usage table must never disrupt the generation flow."""

from datetime import datetime, timezone

import structlog
from supabase import AsyncClient

log = structlog.get_logger()


async def record_usage(
    client: AsyncClient,
    *,
    workspace_id: str,
    provider: str,
    model: str,
    call_type: str,
    prompt_tokens: int,
    output_tokens: int,
    cost_usd: float,
    duration_ms: int,
) -> None:
    try:
        await client.table("llm_usage").insert(
            {
                "workspace_id": workspace_id,
                "provider": provider,
                "model": model,
                "call_type": call_type,
                "prompt_tokens": prompt_tokens,
                "output_tokens": output_tokens,
                "cost_usd": cost_usd,
                "duration_ms": duration_ms,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception:
        log.warning("llm_usage_insert_failed", exc_info=True)
