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


async def get_expiring_connections(
    client: AsyncClient, cutoff_iso: str
) -> list[dict[str, Any]]:
    """Connections whose token expires before the cutoff and aren't already
    flagged for re-auth."""
    res = (
        await client.table("social_connections")
        .select("*")
        .lt("token_expires_at", cutoff_iso)
        .eq("needs_reauth", False)
        .execute()
    )
    return res.data or []


async def flag_needs_reauth(client: AsyncClient, connection_id: str) -> None:
    await client.table("social_connections").update(
        {"needs_reauth": True}
    ).eq("id", connection_id).execute()


async def update_connection_tokens(
    client: AsyncClient, connection_id: str, updates: dict[str, Any]
) -> None:
    await client.table("social_connections").update(updates).eq(
        "id", connection_id
    ).execute()
