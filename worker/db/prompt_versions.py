from typing import Any

from supabase import AsyncClient


async def create_prompt_version(
    client: AsyncClient,
    workspace_id: str,
    system_prompt: str,
    created_by: str,
    source: str = "manual",
) -> dict[str, Any]:
    latest = (
        await client.table("prompt_versions")
        .select("version_number")
        .eq("workspace_id", workspace_id)
        .order("version_number", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    next_version = (latest.data["version_number"] + 1) if latest.data else 1

    res = (
        await client.table("prompt_versions")
        .insert(
            {
                "workspace_id": workspace_id,
                "version_number": next_version,
                "system_prompt": system_prompt,
                "created_by": created_by,
                "source": source,
            }
        )
        .execute()
    )
    return res.data[0]
