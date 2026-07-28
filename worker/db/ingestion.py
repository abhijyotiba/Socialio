import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient


def _url_hash(source_url: str) -> str:
    return hashlib.sha256(source_url.strip().encode()).hexdigest()


async def get_cached_ingestion(
    client: AsyncClient, workspace_id: str, source_url: str
) -> dict[str, Any] | None:
    """Return a cached ingestion result if one exists and is < 7 days old."""
    cache_key = _url_hash(source_url)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    res = (
        await client.table("ingestion_cache")
        .select("*")
        .eq("url_hash", cache_key)
        .eq("workspace_id", workspace_id)
        .gte("cached_at", cutoff)
        .maybe_single()
        .execute()
    )
    return res.data


async def upsert_ingestion_cache(
    client: AsyncClient,
    workspace_id: str,
    source_url: str,
    extracted_title: str,
    extracted_text: str,
    media_assets: list[dict],
) -> None:
    """Store a completed ingestion result in the cache."""
    cache_key = _url_hash(source_url)
    await client.table("ingestion_cache").upsert(
        {
            "url_hash": cache_key,
            "source_url": source_url,
            "workspace_id": workspace_id,
            "extracted_title": extracted_title,
            "extracted_text": extracted_text,
            "media_assets": media_assets,
            "cached_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="url_hash",
    ).execute()


async def delete_expired_cache(client: AsyncClient) -> int:
    """Delete cache rows older than 7 days. Returns count deleted."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    res = (
        await client.table("ingestion_cache")
        .delete()
        .lt("cached_at", cutoff)
        .select("url_hash")
        .execute()
    )
    return len(res.data or [])


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
