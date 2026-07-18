from datetime import datetime, timedelta, timezone
from random import Random
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


async def map_variants_to_campaign_personas(
    client: AsyncClient, campaign_id: str, post_variant_ids: list[str]
) -> list[dict[str, Any]]:
    """Resolve selected post_variant_ids to the campaign_personas that own them,
    scoped to this campaign (RLS + the campaign_id filter reject foreign ids).

    Returns rows {post_variant_id, campaign_persona_id, persona_id, status} for
    only the ids that genuinely belong to campaign_id — the caller uses this to
    validate the selection, filter by actionable status, and know which personas
    were touched."""
    if not post_variant_ids:
        return []
    res = (
        await client.table("campaign_persona_variants")
        .select(
            "post_variant_id, campaign_persona_id, "
            "campaign_personas!inner ( campaign_id, persona_id ), "
            "post_variants!inner ( status )"
        )
        .eq("campaign_personas.campaign_id", campaign_id)
        .in_("post_variant_id", post_variant_ids)
        .execute()
    )
    out: list[dict[str, Any]] = []
    for row in res.data or []:
        cp = row.get("campaign_personas")
        if isinstance(cp, list):
            cp = cp[0] if cp else None
        pv = row.get("post_variants")
        if isinstance(pv, list):
            pv = pv[0] if pv else None
        if not cp:
            continue
        out.append(
            {
                "post_variant_id": row["post_variant_id"],
                "campaign_persona_id": row["campaign_persona_id"],
                "persona_id": cp.get("persona_id"),
                "status": (pv or {}).get("status"),
            }
        )
    return out


async def get_variant_statuses_for_campaign_persona(
    client: AsyncClient, campaign_persona_id: str
) -> list[str]:
    """Statuses of every post_variant belonging to a campaign_persona. Used to
    decide whether a persona is fully approved after a partial (variant-scoped)
    approval so campaign_personas.approval_status stays meaningful."""
    res = (
        await client.table("campaign_persona_variants")
        .select("post_variants!inner ( status )")
        .eq("campaign_persona_id", campaign_persona_id)
        .execute()
    )
    statuses: list[str] = []
    for row in res.data or []:
        pv = row.get("post_variants")
        if isinstance(pv, list):
            pv = pv[0] if pv else None
        if pv and pv.get("status"):
            statuses.append(pv["status"])
    return statuses


def _compute_scheduled_times(
    variants: list[dict[str, Any]],
    *,
    window_start: datetime | None,
    window_end: datetime | None,
    slots_by_persona_platform: dict[tuple[str, str], list[datetime]] | None,
    now: datetime,
    jitter_seconds: int,
    rng: Random,
    anchor: bool = False,
) -> dict[str, datetime]:
    """Pure resolver (no DB) — assign each variant a distinct scheduled_at.

    Precedence (Decision #2290):
      1. window_start/window_end present → spread variants uniformly across the
         window, with small per-variant jitter.
      2. else per-persona+platform posting_schedules slots → next open slot.
      3. else now() + random jitter (0..jitter_seconds).

    When `anchor` is True, precedence 2 is skipped: every variant clusters from
    `now` (the caller's chosen time) and only the distinctness nudge separates
    them. Used by explicit bulk-schedule so the user's chosen datetime is
    honored even for personas that have posting_schedules rows.

    Every variant gets a *distinct* timestamp so 50 posts never fire the same
    second (uniqueness enforced by nudging duplicates forward by 1s)."""
    assigned: dict[str, datetime] = {}

    if window_start and window_end and window_end > window_start:
        n = len(variants)
        span = (window_end - window_start).total_seconds()
        # Uniform spread: variant i at start + i/n * span, plus small jitter
        # bounded so it can't cross into the neighbouring slot.
        step = span / max(n, 1)
        max_jitter = max(0, min(jitter_seconds, int(step / 2)))
        for i, v in enumerate(variants):
            base = window_start + timedelta(seconds=step * i)
            offset = rng.randint(0, max_jitter) if max_jitter > 0 else 0
            assigned[v["id"]] = base + timedelta(seconds=offset)
    elif slots_by_persona_platform and not anchor:
        # Next open posting slot per persona+platform; consume slots so two
        # variants for the same persona+platform don't collide.
        cursor: dict[tuple[str, str], int] = {}
        for v in variants:
            key = (v.get("persona_id") or "", v["platform"])
            slots = slots_by_persona_platform.get(key)
            if slots:
                idx = cursor.get(key, 0)
                assigned[v["id"]] = slots[idx % len(slots)] + timedelta(
                    days=(idx // len(slots))
                )
                cursor[key] = idx + 1
            else:
                assigned[v["id"]] = now + timedelta(
                    seconds=rng.randint(0, max(jitter_seconds, 1))
                )
    else:
        for v in variants:
            assigned[v["id"]] = now + timedelta(
                seconds=rng.randint(0, max(jitter_seconds, 1))
            )

    # Guarantee distinct timestamps (nudge collisions forward by whole seconds).
    seen: set[datetime] = set()
    for vid in sorted(assigned, key=lambda k: assigned[k]):
        t = assigned[vid].replace(microsecond=0)
        while t in seen:
            t = t + timedelta(seconds=1)
        seen.add(t)
        assigned[vid] = t
    return assigned


async def assign_scheduled_times(
    client: AsyncClient,
    variant_ids: list[str],
    *,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    jitter_seconds: int = 5400,  # ±90 min default
    now: datetime | None = None,
    anchor: bool = False,
) -> dict[str, str]:
    """Set a distinct, non-null scheduled_at on every variant in variant_ids.

    This repairs the live bug where approved campaign variants were set to
    status='scheduled' with a NULL scheduled_at and therefore never claimed by
    claim_due_variants (which requires scheduled_at <= now()).

    Resolver precedence: brief window → persona posting_schedules → now()+jitter.
    When `anchor` is True, posting_schedules are skipped so variants cluster from
    `now` (the caller's explicitly chosen time) — used by bulk-schedule.
    Returns {variant_id: iso_timestamp}."""
    if not variant_ids:
        return {}

    now = now or datetime.now(timezone.utc)
    rng = Random()

    # Fetch the variants we're scheduling (persona_id + platform for slot lookup).
    vres = (
        await client.table("post_variants")
        .select("id, persona_id, platform, workspace_id")
        .in_("id", variant_ids)
        .execute()
    )
    variants = vres.data or []
    if not variants:
        return {}

    slots_by_persona_platform: dict[tuple[str, str], list[datetime]] | None = None
    if not anchor and not (window_start and window_end):
        slots_by_persona_platform = await _load_next_slots(client, variants, now)

    assigned = _compute_scheduled_times(
        variants,
        window_start=window_start,
        window_end=window_end,
        slots_by_persona_platform=slots_by_persona_platform,
        now=now,
        jitter_seconds=jitter_seconds,
        rng=rng,
        anchor=anchor,
    )

    # Persist per-variant (distinct timestamps → one update each).
    for vid, when in assigned.items():
        await client.table("post_variants").update(
            {"scheduled_at": when.isoformat()}
        ).eq("id", vid).execute()

    return {vid: when.isoformat() for vid, when in assigned.items()}


async def _load_next_slots(
    client: AsyncClient, variants: list[dict[str, Any]], now: datetime
) -> dict[tuple[str, str], list[datetime]]:
    """Resolve upcoming posting_schedules slots per persona+platform, as absolute
    datetimes on/after `now`. Returns empty dict when no slots configured."""
    workspace_ids = {v["workspace_id"] for v in variants if v.get("workspace_id")}
    if not workspace_ids:
        return {}
    platforms = {v["platform"] for v in variants}
    res = (
        await client.table("posting_schedules")
        .select("persona_id, platform, hour, minute, is_active")
        .in_("workspace_id", list(workspace_ids))
        .in_("platform", list(platforms))
        .execute()
    )
    rows = [r for r in (res.data or []) if r.get("is_active", True)]
    if not rows:
        return {}

    out: dict[tuple[str, str], list[datetime]] = {}
    for r in rows:
        key = (r.get("persona_id") or "", r["platform"])
        # Next occurrence of hour:minute at/after now (today or tomorrow, UTC).
        candidate = now.replace(
            hour=r["hour"], minute=r["minute"], second=0, microsecond=0
        )
        if candidate < now:
            candidate = candidate + timedelta(days=1)
        out.setdefault(key, []).append(candidate)
    for key in out:
        out[key].sort()
    return out


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
