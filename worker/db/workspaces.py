from supabase import AsyncClient


async def get_workspace_id_for_user(
    client: AsyncClient, user_id: str
) -> str | None:
    res = (
        await client.table("workspace_members")
        .select("workspace_id")
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0]["workspace_id"]
