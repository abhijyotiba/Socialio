from typing import Any

from supabase import AsyncClient


async def get_connections_for_persona(
    client: AsyncClient, persona_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("social_connections")
        .select("*")
        .eq("persona_id", persona_id)
        .execute()
    )
    return res.data or []
