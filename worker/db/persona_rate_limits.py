from supabase import AsyncClient


async def increment(client: AsyncClient, persona_id: str, platform: str) -> None:
    """Bump the persona's daily post counter via the increment_persona_rate_limit
    RPC (upsert with a per-day reset). Called on every successful publish so the
    daily-cap guard in claim_due_variants has a live counter to check.
    Service-role client only (the RPC is service_role-only)."""
    await client.rpc(
        "increment_persona_rate_limit",
        {"p_persona_id": persona_id, "p_platform": platform},
    ).execute()
