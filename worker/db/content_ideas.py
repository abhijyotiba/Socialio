from typing import Any
from supabase import AsyncClient


async def create_content_ideas(
    client: AsyncClient, ideas: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not ideas:
        return []
    res = await client.table("content_ideas").insert(ideas).execute()
    return res.data or []


async def list_ideas_for_job(
    client: AsyncClient, ingestion_job_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("content_ideas")
        .select("*")
        .eq("ingestion_job_id", ingestion_job_id)
        .execute()
    )
    return res.data or []
