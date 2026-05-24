from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient


async def create_job(
    client: AsyncClient,
    *,
    workspace_id: str,
    source_type: str,
    source_url: str | None,
    source_text: str | None,
    stage: str = "pending",
) -> dict[str, Any]:
    res = (
        await client.table("ingestion_jobs")
        .insert(
            {
                "workspace_id": workspace_id,
                "source_type": source_type,
                "source_url": source_url,
                "source_text": source_text,
                "stage": stage,
            }
        )
        .execute()
    )
    return res.data[0]


async def update_job(
    client: AsyncClient, job_id: str, patch: dict[str, Any]
) -> None:
    await client.table("ingestion_jobs").update(patch).eq("id", job_id).execute()


async def get_job(client: AsyncClient, job_id: str) -> dict[str, Any] | None:
    res = (
        await client.table("ingestion_jobs")
        .select("*")
        .eq("id", job_id)
        .execute()
    )
    return res.data[0] if res.data else None


async def count_recent_jobs(
    client: AsyncClient, workspace_id: str, window_seconds: int
) -> int:
    since = (
        datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    ).isoformat()
    res = (
        await client.table("ingestion_jobs")
        .select("id", count="exact", head=True)
        .eq("workspace_id", workspace_id)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0
