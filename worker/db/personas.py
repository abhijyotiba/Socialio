from typing import Any

from supabase import AsyncClient


async def get_persona(client: AsyncClient, persona_id: str) -> dict[str, Any] | None:
    res = (
        await client.table("personas")
        .select("*")
        .eq("id", persona_id)
        .maybe_single()
        .execute()
    )
    return res.data
