from typing import Any

from supabase import AsyncClient


async def snapshot_variant_body(
    client: AsyncClient,
    *,
    variant_id: str,
    workspace_id: str,
    body: str,
    instruction: str | None,
) -> dict[str, Any]:
    """Insert a snapshot of a variant body at the next revision number.
    instruction=None for the pre-regeneration baseline."""
    latest = (
        await client.table("post_variant_revisions")
        .select("revision_number")
        .eq("post_variant_id", variant_id)
        .order("revision_number", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    next_number = (latest.data["revision_number"] + 1) if latest.data else 1

    res = (
        await client.table("post_variant_revisions")
        .insert(
            {
                "post_variant_id": variant_id,
                "workspace_id": workspace_id,
                "revision_number": next_number,
                "body": body,
                "instruction": instruction,
            }
        )
        .execute()
    )
    return res.data[0]
