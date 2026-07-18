"""DB helpers for account (persona) groups — Task 7.

Groups let an operator target "all of Group X" in a campaign instead of
hand-picking personas. All queries run under the caller's RLS client, so
workspace isolation is enforced by policy (migration 0027).
"""

from typing import Any

from supabase import AsyncClient


async def list_groups(client: AsyncClient) -> list[dict[str, Any]]:
    """All groups visible to the caller, each with its member persona_ids."""
    groups_res = (
        await client.table("persona_groups")
        .select("id, name, workspace_id, created_at")
        .order("name", desc=False)
        .execute()
    )
    groups = groups_res.data or []
    if not groups:
        return []

    group_ids = [g["id"] for g in groups]
    members_res = (
        await client.table("persona_group_members")
        .select("group_id, persona_id")
        .in_("group_id", group_ids)
        .execute()
    )
    members_by_group: dict[str, list[str]] = {}
    for m in members_res.data or []:
        members_by_group.setdefault(m["group_id"], []).append(m["persona_id"])

    for g in groups:
        g["persona_ids"] = members_by_group.get(g["id"], [])
    return groups


async def create_group(
    client: AsyncClient, workspace_id: str, name: str
) -> dict[str, Any]:
    res = (
        await client.table("persona_groups")
        .insert({"workspace_id": workspace_id, "name": name})
        .execute()
    )
    return res.data[0]


async def rename_group(
    client: AsyncClient, group_id: str, name: str
) -> dict[str, Any] | None:
    res = (
        await client.table("persona_groups")
        .update({"name": name})
        .eq("id", group_id)
        .execute()
    )
    return (res.data or [None])[0]


async def delete_group(client: AsyncClient, group_id: str) -> None:
    # persona_group_members cascade via FK ON DELETE CASCADE.
    await client.table("persona_groups").delete().eq("id", group_id).execute()


async def add_members(
    client: AsyncClient, group_id: str, persona_ids: list[str]
) -> None:
    if not persona_ids:
        return
    rows = [
        {"group_id": group_id, "persona_id": pid}
        for pid in dict.fromkeys(persona_ids)  # dedup, preserve order
    ]
    # upsert so re-adding an existing member is a no-op (PK is group_id+persona_id)
    await client.table("persona_group_members").upsert(
        rows, on_conflict="group_id,persona_id"
    ).execute()


async def remove_members(
    client: AsyncClient, group_id: str, persona_ids: list[str]
) -> None:
    if not persona_ids:
        return
    await (
        client.table("persona_group_members")
        .delete()
        .eq("group_id", group_id)
        .in_("persona_id", persona_ids)
        .execute()
    )


async def set_members(
    client: AsyncClient, group_id: str, persona_ids: list[str]
) -> None:
    """Replace a group's membership with exactly persona_ids."""
    await (
        client.table("persona_group_members")
        .delete()
        .eq("group_id", group_id)
        .execute()
    )
    await add_members(client, group_id, persona_ids)


async def expand_group_ids_to_persona_ids(
    client: AsyncClient, group_ids: list[str]
) -> list[str]:
    """Resolve a list of group ids to a deduped list of member persona_ids
    (order not significant). RLS scopes this to the caller's workspace."""
    if not group_ids:
        return []
    res = (
        await client.table("persona_group_members")
        .select("persona_id")
        .in_("group_id", group_ids)
        .execute()
    )
    return list(dict.fromkeys(r["persona_id"] for r in (res.data or [])))
