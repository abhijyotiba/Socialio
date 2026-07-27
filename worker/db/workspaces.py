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
    """Look up the workspace owner's email via auth.users. Uses the service-role
    client (svc) because auth.admin requires admin privileges. Returns None if
    the owner cannot be found or the user has no email."""
    try:
        # Find the owner (role='owner') in workspace_members
        res = (
            await svc.table("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspace_id)
            .eq("role", "owner")
            .limit(1)
            .maybe_single()
            .execute()
        )
        if not res.data:
            return None
        user_id = res.data["user_id"]
        user = await svc.auth.admin.get_user_by_id(user_id)
        # user is a User object with email attribute
        email = getattr(user, "email", None) or (
            user.user.email if hasattr(user, "user") else None
        )
        return email
    except Exception:
        return None
