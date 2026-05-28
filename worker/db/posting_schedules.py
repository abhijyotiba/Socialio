from typing import Any
from supabase import AsyncClient


async def get_schedule_slots_for_workspace(
    client: AsyncClient, workspace_id: str, platform: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("posting_schedules")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("platform", platform)
        .order("hour", desc=False)
        .order("minute", desc=False)
        .execute()
    )
    return res.data or []


async def create_schedule_slot(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    workspace_id = values["workspace_id"]
    persona_id = values.get("persona_id")

    if not persona_id:
        # Find default persona for workspace
        persona_res = (
            await client.table("personas")
            .select("id")
            .eq("workspace_id", workspace_id)
            .eq("is_default", True)
            .maybe_single()
            .execute()
        )
        if not persona_res.data:
            raise ValueError("No default persona found for workspace")
        persona_id = persona_res.data["id"]

    insert_values = {**values, "persona_id": persona_id}
    res = await client.table("posting_schedules").insert(insert_values).execute()
    return res.data[0]


async def delete_schedule_slot(
    client: AsyncClient, slot_id: str, workspace_id: str
) -> None:
    await (
        client.table("posting_schedules")
        .delete()
        .eq("id", slot_id)
        .eq("workspace_id", workspace_id)
        .execute()
    )
