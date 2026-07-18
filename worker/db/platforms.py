from supabase import AsyncClient


async def list_active_platforms(client: AsyncClient) -> list[str]:
    """Return the slugs of all active platforms from the `platforms` registry.

    Source of truth is the `public.platforms` table (migration 0023). Only rows
    with `is_active = true` are returned, ordered by slug for stable output.
    """
    res = (
        await client.table("platforms")
        .select("slug")
        .eq("is_active", True)
        .order("slug", desc=False)
        .execute()
    )
    return [row["slug"] for row in (res.data or [])]
