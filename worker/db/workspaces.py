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


async def get_workspace_owner_email(
    svc: AsyncClient, workspace_id: str
) -> str | None:
    """Look up the workspace owner's email via the get_workspace_owner_email RPC.
    Uses the service-role client (svc) because the function is SECURITY DEFINER
    and restricted to service_role. Returns None if no owner is found."""
    try:
        res = await svc.rpc(
            "get_workspace_owner_email",
            {"p_workspace_id": workspace_id},
        ).execute()
        return res.data if res.data else None
    except Exception:
        return None
