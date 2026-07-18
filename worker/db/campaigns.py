from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient


async def fail_zombie_campaigns(
    client: AsyncClient, older_than_minutes: int = 15
) -> list[dict[str, Any]]:
    """Mark campaigns stuck in 'generating' past the window as failed. Returns
    the affected rows (id, workspace_id) so the caller can reject their pending
    personas and emit audit events.

    Window math: at the 50-persona cap, generation runs 50 personas through an
    LLM concurrency cap of 5 (adapters/llm._LLM_SEMAPHORE) at ~2 LLM calls each
    × ~10s ≈ 50/5 × 2 × 10s ≈ 200s ≪ 15 min. The generous window keeps the cron
    from killing a legitimately in-flight large campaign mid-generation.
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    ).isoformat()
    res = (
        await client.table("campaigns")
        .update(
            {
                "status": "failed",
                "failure_code": "GENERATION_TIMEOUT",
                "failure_reason": "Generation exceeded the 15-minute window.",
            }
        )
        .eq("status", "generating")
        .lt("generation_started_at", cutoff)
        .select("id, workspace_id")
        .execute()
    )
    return res.data or []


async def reject_pending_personas(
    client: AsyncClient, campaign_ids: list[str]
) -> None:
    if not campaign_ids:
        return
    await client.table("campaign_personas").update(
        {"approval_status": "rejected"}
    ).eq("approval_status", "pending").in_("campaign_id", campaign_ids).execute()


async def count_recent_campaigns(
    client: AsyncClient, workspace_id: str, window_seconds: int
) -> int:
    since = (
        datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    ).isoformat()
    res = (
        await client.table("campaigns")
        .select("id", count="exact", head=True)
        .eq("workspace_id", workspace_id)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


async def create_campaign(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    res = await client.table("campaigns").insert(values).execute()
    return res.data[0]


async def update_campaign(
    client: AsyncClient, campaign_id: str, patch: dict[str, Any]
) -> None:
    await client.table("campaigns").update(patch).eq("id", campaign_id).execute()


async def create_campaign_personas(
    client: AsyncClient, campaign_id: str, persona_ids: list[str]
) -> list[dict[str, Any]]:
    res = (
        await client.table("campaign_personas")
        .insert(
            [
                {"campaign_id": campaign_id, "persona_id": pid}
                for pid in persona_ids
            ]
        )
        .execute()
    )
    return res.data or []


async def set_campaign_persona_error(
    client: AsyncClient, campaign_persona_id: str, error: str
) -> None:
    await client.table("campaign_personas").update(
        {"generation_error": error}
    ).eq("id", campaign_persona_id).execute()


async def create_campaign_persona_variants(
    client: AsyncClient,
    campaign_persona_id: str,
    variants: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    res = (
        await client.table("campaign_persona_variants")
        .insert(
            [
                {
                    "campaign_persona_id": campaign_persona_id,
                    "post_variant_id": v["post_variant_id"],
                    "platform": v["platform"],
                    "prompt_version_id": v.get("prompt_version_id"),
                }
                for v in variants
            ]
        )
        .execute()
    )
    return res.data or []


async def get_campaign(
    client: AsyncClient, campaign_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("campaigns")
        .select("*")
        .eq("id", campaign_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def get_campaign_personas(
    client: AsyncClient, campaign_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("campaign_personas")
        .select("id, persona_id, approval_status")
        .eq("campaign_id", campaign_id)
        .execute()
    )
    return res.data or []


async def get_autopilot_campaign_for_job(
    client: AsyncClient, ingestion_job_id: str
) -> dict[str, Any] | None:
    """The single autopilot campaign for an asset, or None. Used by atomize
    (find-or-create) and the refill cron (link variant)."""
    res = (
        await client.table("campaigns")
        .select("*")
        .eq("ingestion_job_id", ingestion_job_id)
        .eq("kind", "autopilot")
        .maybe_single()
        .execute()
    )
    return res.data


async def get_campaign_persona(
    client: AsyncClient, campaign_id: str, persona_id: str
) -> dict[str, Any] | None:
    res = (
        await client.table("campaign_personas")
        .select("id, persona_id, approval_status")
        .eq("campaign_id", campaign_id)
        .eq("persona_id", persona_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def update_campaign_persona_approval(
    client: AsyncClient, campaign_persona_id: str, status: str
) -> None:
    approved_at = (
        datetime.now(timezone.utc).isoformat() if status == "approved" else None
    )
    await client.table("campaign_personas").update(
        {"approval_status": status, "approved_at": approved_at}
    ).eq("id", campaign_persona_id).execute()


async def get_variants_for_campaign_persona(
    client: AsyncClient, campaign_persona_id: str
) -> list[str]:
    res = (
        await client.table("campaign_persona_variants")
        .select("post_variant_id")
        .eq("campaign_persona_id", campaign_persona_id)
        .execute()
    )
    return [r["post_variant_id"] for r in (res.data or [])]


async def set_post_variants_status(
    client: AsyncClient, variant_ids: list[str], status: str
) -> None:
    if not variant_ids:
        return
    await client.table("post_variants").update({"status": status}).in_(
        "id", variant_ids
    ).execute()


async def delete_campaign(client: AsyncClient, campaign_id: str) -> None:
    await client.table("campaigns").delete().eq("id", campaign_id).execute()


# A variant is "live" if it's headed for, or has touched, a real social network.
# Deleting the campaign cascades to post_variants and would erase that audit
# trail — never allow it.
_LIVE_VARIANT_STATUSES = ["scheduled", "publishing", "published"]


async def _campaign_variant_ids(
    client: AsyncClient, campaign_id: str
) -> list[str]:
    cps = (
        await client.table("campaign_personas")
        .select("id")
        .eq("campaign_id", campaign_id)
        .execute()
    )
    cp_ids = [r["id"] for r in (cps.data or [])]
    if not cp_ids:
        return []
    cpvs = (
        await client.table("campaign_persona_variants")
        .select("post_variant_id")
        .in_("campaign_persona_id", cp_ids)
        .execute()
    )
    return [r["post_variant_id"] for r in (cpvs.data or [])]


async def has_live_variants(client: AsyncClient, campaign_id: str) -> bool:
    variant_ids = await _campaign_variant_ids(client, campaign_id)
    if not variant_ids:
        return False
    res = (
        await client.table("post_variants")
        .select("id", count="exact", head=True)
        .in_("id", variant_ids)
        .in_("status", _LIVE_VARIANT_STATUSES)
        .execute()
    )
    return (res.count or 0) > 0


async def cancel_scheduled_variants_for_campaign(
    client: AsyncClient, campaign_id: str
) -> int:
    variant_ids = await _campaign_variant_ids(client, campaign_id)
    if not variant_ids:
        return 0
    res = (
        await client.table("post_variants")
        .update({"status": "cancelled"})
        .in_("id", variant_ids)
        .eq("status", "scheduled")
        .execute()
    )
    return len(res.data or [])
