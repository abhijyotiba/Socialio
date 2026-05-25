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


async def get_social_connection_for_persona(
    client: AsyncClient, persona_id: str, platform: str
) -> dict[str, Any] | None:
    res = (
        await client.table("social_connections")
        .select("*")
        .eq("persona_id", persona_id)
        .eq("platform", platform)
        .maybe_single()
        .execute()
    )
    return res.data


async def get_default_social_connection(
    client: AsyncClient, workspace_id: str, platform: str
) -> dict[str, Any] | None:
    """Workspace-scoped fallback for pre-persona variants (persona_id NULL).
    Mirrors web's legacy getSocialConnection."""
    res = (
        await client.table("social_connections")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("platform", platform)
        .maybe_single()
        .execute()
    )
    return res.data
