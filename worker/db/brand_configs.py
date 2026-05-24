from typing import Any

from supabase import AsyncClient


async def get_brand_config_for_persona(
    client: AsyncClient, persona_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("brand_configs")
        .select("*")
        .eq("persona_id", persona_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def get_default_brand_config(
    client: AsyncClient, workspace_id: str
) -> dict[str, Any] | None:
    """Workspace-default brand, for variants whose persona was deleted
    (persona_id NULL). Mirrors web's legacy getBrandConfig fallback."""
    res = (
        await client.table("brand_configs")
        .select("*, personas!inner(workspace_id, is_default)")
        .eq("personas.workspace_id", workspace_id)
        .eq("personas.is_default", True)
        .maybe_single()
        .execute()
    )
    if not res.data:
        return None
    row = dict(res.data)
    row.pop("personas", None)
    return row
