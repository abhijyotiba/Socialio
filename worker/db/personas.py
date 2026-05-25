import re
import time
from typing import Any

from supabase import AsyncClient

PERSONA_HARD_CAP = 50


async def get_persona(client: AsyncClient, persona_id: str) -> dict[str, Any] | None:
    res = (
        await client.table("personas")
        .select("*")
        .eq("id", persona_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def get_default_persona(
    client: AsyncClient, workspace_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("personas")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("is_default", True)
        .maybe_single()
        .execute()
    )
    return res.data


async def count_personas(client: AsyncClient, workspace_id: str) -> int:
    res = (
        await client.table("personas")
        .select("id", count="exact", head=True)
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return res.count or 0


async def generate_persona_slug(
    client: AsyncClient, workspace_id: str, name: str
) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "persona"
    for i in range(11):
        slug = base if i == 0 else f"{base}-{i + 1}"
        res = (
            await client.table("personas")
            .select("id")
            .eq("workspace_id", workspace_id)
            .eq("slug", slug)
            .maybe_single()
            .execute()
        )
        if not res.data:
            return slug
    return f"{base}-{int(time.time() * 1000)}"


async def create_persona(
    client: AsyncClient,
    workspace_id: str,
    name: str,
    avatar_color: str | None = None,
) -> dict[str, Any]:
    if await count_personas(client, workspace_id) >= PERSONA_HARD_CAP:
        raise ValueError(
            f"Workspace has reached the maximum of {PERSONA_HARD_CAP} personas"
        )
    slug = await generate_persona_slug(client, workspace_id, name)
    res = (
        await client.table("personas")
        .insert(
            {
                "workspace_id": workspace_id,
                "name": name,
                "slug": slug,
                "avatar_color": avatar_color or "#6366f1",
            }
        )
        .execute()
    )
    return res.data[0]


async def update_persona(
    client: AsyncClient, persona_id: str, patch: dict[str, Any]
) -> None:
    if not patch:
        return
    await client.table("personas").update(patch).eq("id", persona_id).execute()


async def delete_persona(client: AsyncClient, persona_id: str) -> None:
    """Raises ValueError on a guard violation (default persona / pending
    campaigns); the route maps that to a 409."""
    res = (
        await client.table("personas")
        .select("is_default")
        .eq("id", persona_id)
        .maybe_single()
        .execute()
    )
    if res.data and res.data.get("is_default"):
        raise ValueError("Cannot delete the default persona")

    pending = (
        await client.table("campaign_personas")
        .select("id", count="exact", head=True)
        .eq("persona_id", persona_id)
        .eq("approval_status", "pending")
        .execute()
    )
    if (pending.count or 0) > 0:
        raise ValueError(
            "Cannot delete a persona with pending campaigns. Reject or complete them first."
        )

    await client.table("personas").delete().eq("id", persona_id).execute()

