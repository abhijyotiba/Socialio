from datetime import datetime, timezone
from typing import Any

from supabase import AsyncClient


async def upsert_brand_config(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    res = (
        await client.table("brand_configs")
        .upsert(values, on_conflict="persona_id")
        .execute()
    )
    return res.data[0]


async def set_voice_profile_for_persona(
    client: AsyncClient, persona_id: str, profile: Any
) -> None:
    await client.table("brand_configs").update(
        {
            "voice_profile": profile,
            "voice_profile_updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("persona_id", persona_id).execute()


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
