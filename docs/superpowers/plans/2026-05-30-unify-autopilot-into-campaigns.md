# Unify Autopilot Review into Campaigns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the standalone Review Queue into the existing Campaigns UI — engine-atomized assets become `kind='autopilot'` campaigns reviewed per-post — and delete every piece of code the Review Queue leaves orphaned, with no N+1 regressions on the campaign list.

**Architecture:** Add `campaigns.kind` (manual|autopilot). `run_atomize` find-or-creates an autopilot campaign per asset; the refill cron links each rendered variant into it via the existing `campaign_persona_variants` join. The campaign detail UI branches on `kind`: manual = unchanged, autopilot = a per-post review list using the already-built `/posts/{id}/review` route. The standalone `/review` page and everything only it used are deleted; the low-fuel banner relocates to the Campaigns list.

**Tech Stack:** Python/FastAPI worker (uv, pytest), Supabase Postgres + RLS, Next.js 16 App Router (TS strict, Vitest). Spec: `docs/superpowers/specs/2026-05-30-unify-autopilot-into-campaigns-design.md`.

**Two cross-cutting requirements (enforced in the tasks, not appended):**
- **Cleanup:** every function/type/endpoint/test that becomes unreachable after unification is deleted in the same task that orphans it. Tracked explicitly in Phase 4 with a grep-verified dead-code sweep.
- **Performance:** no N+1. The campaign list's per-campaign pending count must be computed in **one** query (a grouped count), not a query-per-campaign. Verified in Task 5.1.

---

## File-structure map

| File | Change |
|---|---|
| `supabase/migrations/0022_campaign_kind.sql` | **Create** — add `campaigns.kind` |
| `web/lib/db/types.ts` | **Regenerate** via `gen:types` |
| `worker/db/campaigns.py` | **Modify** — add `get_autopilot_campaign_for_job`, `get_campaign_persona`, `count_pending_variants_by_campaign` |
| `worker/routes/content_engine.py` | **Modify** — `run_atomize` find-or-creates the autopilot campaign |
| `worker/cron/jobs.py` | **Modify** — link rendered variant into the asset's campaign |
| `worker/tests/test_content_engine_route.py` | **Modify** — assert campaign creation |
| `worker/tests/test_refill_cron.py` | **Modify** — assert variant linked to campaign |
| `web/lib/db/campaigns.ts` | **Modify** — `kind` in types, correct per-kind counts (single grouped query) |
| `web/app/(app)/campaigns/page.tsx` | **Modify** — autopilot chip, correct counts, low-fuel banner |
| `web/app/(app)/campaigns/[id]/_components/CampaignReview.tsx` | **Modify** — branch on `kind` |
| `web/app/(app)/campaigns/[id]/_components/AutopilotVariantList.tsx` | **Create** — per-post review island |
| `web/app/(app)/review/` | **Delete** — page + island |
| `web/lib/db/content-engine.ts` | **Modify** — delete `listPendingApprovalVariants` + its type |
| `web/components/app/Sidebar.tsx` | **Modify** — remove "Review" nav item |
| `web/components/app/LowFuelBanner.tsx` | **Keep** — now used by Campaigns list |
| `web/app/api/posts/[id]/review/route.ts`, `workerReviewPost`, worker `/posts/{id}/review` | **Keep** — now called by the autopilot branch |

---

## Phase 0 — Schema

### Task 0.1: Add `campaigns.kind`

**Files:**
- Create: `supabase/migrations/0022_campaign_kind.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_campaign_kind.sql`:

```sql
-- Unify autopilot review into campaigns: distinguish manual vs autopilot campaigns.
-- Manual = the existing ingest→generate→per-persona-approve flow (default, unchanged).
-- Autopilot = one campaign per atomized asset, filled by the refill cron, reviewed per-post.

ALTER TABLE public.campaigns
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'
  CHECK (kind IN ('manual', 'autopilot'));

-- Find the autopilot campaign for an asset quickly (atomize find-or-create + cron link).
CREATE INDEX idx_campaigns_autopilot_job
  ON public.campaigns (ingestion_job_id)
  WHERE kind = 'autopilot';
```

- [ ] **Step 2: Verify SQL**

Run: `grep -n "kind\|idx_campaigns_autopilot" supabase/migrations/0022_campaign_kind.sql`
Expected: the column with the CHECK and the partial index are present.

- [ ] **Step 3: Apply the migration**

Apply `0022_campaign_kind.sql` to the dev DB (Supabase SQL editor or `pnpm --dir web supabase db push`).
Expected: applies cleanly; `campaigns` now has a `kind` column defaulting to `'manual'`.

- [ ] **Step 4: Regenerate types**

Run: `pnpm --dir web gen:types`
Expected: `web/lib/db/types.ts` updates; `campaigns` Row/Insert/Update gain `kind`.

- [ ] **Step 5: Verify types**

Run: `grep -n "kind" web/lib/db/types.ts | head`
Expected: `kind: string` appears under the campaigns table block.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0022_campaign_kind.sql web/lib/db/types.ts
git commit -m "feat(db): add campaigns.kind (manual|autopilot)"
```

---

## Phase 1 — Worker: atomize creates the autopilot campaign

### Task 1.1: New db helpers for campaign lookup + counts

**Files:**
- Modify: `worker/db/campaigns.py`
- Test: `worker/tests/test_content_engine_db.py` (reuses the shared chainable mock there)

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_content_engine_db.py`:

```python
@pytest.mark.asyncio
async def test_get_autopilot_campaign_for_job_filters_kind_and_job():
    client, chain = _fake_client_returning([{"id": "cam1", "kind": "autopilot"}])
    from db.campaigns import get_autopilot_campaign_for_job
    row = await get_autopilot_campaign_for_job(client, "job-1")
    assert row["id"] == "cam1"
    chain.eq.assert_any_call("ingestion_job_id", "job-1")
    chain.eq.assert_any_call("kind", "autopilot")


@pytest.mark.asyncio
async def test_get_autopilot_campaign_for_job_returns_none_when_absent():
    client, chain = _fake_client_returning([])
    from db.campaigns import get_autopilot_campaign_for_job
    row = await get_autopilot_campaign_for_job(client, "job-1")
    assert row is None


@pytest.mark.asyncio
async def test_get_campaign_persona_filters_campaign_and_persona():
    client, chain = _fake_client_returning([{"id": "cp1", "persona_id": "p1"}])
    from db.campaigns import get_campaign_persona
    row = await get_campaign_persona(client, "cam1", "p1")
    assert row["id"] == "cp1"
    chain.eq.assert_any_call("campaign_id", "cam1")
    chain.eq.assert_any_call("persona_id", "p1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -k "autopilot_campaign or campaign_persona_filters" -v`
Expected: FAIL with `ImportError: cannot import name 'get_autopilot_campaign_for_job'`

- [ ] **Step 3: Implement the helpers**

Append to `worker/db/campaigns.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -k "autopilot_campaign or campaign_persona_filters" -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/db/campaigns.py worker/tests/test_content_engine_db.py
git commit -m "feat(worker): campaign lookup helpers for autopilot unification"
```

### Task 1.2: `run_atomize` find-or-creates the autopilot campaign

**Files:**
- Modify: `worker/routes/content_engine.py`
- Test: `worker/tests/test_content_engine_route.py`

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_content_engine_route.py`:

```python
@pytest.mark.asyncio
async def test_atomize_creates_autopilot_campaign_when_absent():
    from routes.content_engine import run_atomize
    fake_ideas = [{
        "essence": "e", "idea_type": "claim", "source_quote": "q",
        "strength": 4, "suitable_formats": ["hot_take"], "suitable_angles": ["expert"],
    }]
    fake_client = AsyncMock()
    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat, \
         patch("routes.content_engine.db_campaigns.get_autopilot_campaign_for_job", new_callable=AsyncMock) as mock_get_cam, \
         patch("routes.content_engine.db_campaigns.create_campaign", new_callable=AsyncMock) as mock_create_cam, \
         patch("routes.content_engine.db_campaigns.create_campaign_personas", new_callable=AsyncMock) as mock_create_cp:
        mock_extract.return_value = fake_ideas
        mock_save.return_value = [{**fake_ideas[0], "id": "idea-1"}]
        mock_mat.return_value = [{"id": "cell-1"}]
        mock_get_cam.return_value = None              # no campaign yet
        mock_create_cam.return_value = {"id": "cam-1"}
        mock_create_cp.return_value = [{"id": "cp-1"}]
        result = await run_atomize(
            client=fake_client, workspace_id="w1", persona_id="p1",
            ingestion_job_id="job-1", title="My Asset", text="text",
            brand_system_prompt="b", platforms=["linkedin"],
        )
    mock_create_cam.assert_awaited_once()
    created = mock_create_cam.call_args[0][1]
    assert created["kind"] == "autopilot"
    assert created["ingestion_job_id"] == "job-1"
    mock_create_cp.assert_awaited_once()
    assert result["campaign_id"] == "cam-1"


@pytest.mark.asyncio
async def test_atomize_reuses_existing_autopilot_campaign():
    from routes.content_engine import run_atomize
    fake_client = AsyncMock()
    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat, \
         patch("routes.content_engine.db_campaigns.get_autopilot_campaign_for_job", new_callable=AsyncMock) as mock_get_cam, \
         patch("routes.content_engine.db_campaigns.create_campaign", new_callable=AsyncMock) as mock_create_cam:
        mock_extract.return_value = [{
            "essence": "e", "idea_type": "claim", "source_quote": "q",
            "strength": 4, "suitable_formats": ["hot_take"], "suitable_angles": ["expert"],
        }]
        mock_save.return_value = [{"id": "idea-1", "suitable_formats": ["hot_take"], "suitable_angles": ["expert"]}]
        mock_mat.return_value = [{"id": "cell-1"}]
        mock_get_cam.return_value = {"id": "existing-cam"}   # already exists
        result = await run_atomize(
            client=fake_client, workspace_id="w1", persona_id="p1",
            ingestion_job_id="job-1", title="T", text="text",
            brand_system_prompt="b", platforms=["linkedin"],
        )
    mock_create_cam.assert_not_called()
    assert result["campaign_id"] == "existing-cam"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -k "autopilot_campaign or reuses_existing" -v`
Expected: FAIL (`run_atomize` doesn't touch campaigns yet; `db_campaigns` not imported)

- [ ] **Step 3: Implement**

In `worker/routes/content_engine.py`, add the import near the other `from db import ...` lines:

```python
from db import campaigns as db_campaigns
```

Then, in `run_atomize`, replace the final `return {...}` block. The current tail is:

```python
    materialized = await db_cells.materialize_cells(client, cells)
    return {
        "ideas_extracted": len(saved),
        "cells_materialized": len(materialized),
    }
```

Replace it with:

```python
    materialized = await db_cells.materialize_cells(client, cells)

    # Find-or-create the autopilot campaign for this asset. One per asset:
    # re-atomizing the same asset reuses it (idempotent).
    campaign = await db_campaigns.get_autopilot_campaign_for_job(
        client, ingestion_job_id
    )
    if campaign is None:
        campaign = await db_campaigns.create_campaign(
            client,
            {
                "workspace_id": workspace_id,
                "ingestion_job_id": ingestion_job_id,
                "title": title or "Autopilot",
                "kind": "autopilot",
                "status": "pending_approval",
            },
        )
        await db_campaigns.create_campaign_personas(
            client, campaign["id"], [persona_id]
        )

    return {
        "ideas_extracted": len(saved),
        "cells_materialized": len(materialized),
        "campaign_id": campaign["id"],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -v`
Expected: PASS — new tests plus the existing atomize tests. Note: the existing `test_atomize_with_no_ideas_materializes_nothing` returns before the campaign block (no ideas → early return), so it stays green. Confirm it still passes.

- [ ] **Step 5: Commit**

```bash
git add worker/routes/content_engine.py worker/tests/test_content_engine_route.py
git commit -m "feat(worker): atomize find-or-creates the autopilot campaign per asset"
```

---

## Phase 2 — Worker: refill cron links variants into the campaign

### Task 2.1: Link each rendered variant via campaign_persona_variants

**Files:**
- Modify: `worker/cron/jobs.py`
- Test: `worker/tests/test_refill_cron.py`

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_refill_cron.py`:

```python
@pytest.mark.asyncio
async def test_refill_links_variant_into_autopilot_campaign():
    cadence = {
        "id": "cad1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "posts_per_week": 3, "autopilot_enabled": False,
        "active": True, "low_reservoir_threshold": 5,
    }
    planned_cell = {
        "id": "cell1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "format": "hot_take", "angle": "expert",
        "idea_id": "idea1", "ingestion_job_id": "job-1",
        "content_ideas": {"essence": "e", "source_quote": "q"},
    }
    svc = AsyncMock()
    with patch("cron.jobs.db_cadences.list_active_cadences", new_callable=AsyncMock) as mock_cad, \
         patch("cron.jobs.db_cells.count_reservoir", new_callable=AsyncMock) as mock_count, \
         patch("cron.jobs.db_cells.next_planned_cells", new_callable=AsyncMock) as mock_next, \
         patch("cron.jobs.db_brand.get_brand_config_for_persona", new_callable=AsyncMock) as mock_brand, \
         patch("cron.jobs.render_cell", new_callable=AsyncMock) as mock_render, \
         patch("cron.jobs.db_posts.create_content_item", new_callable=AsyncMock) as mock_ci, \
         patch("cron.jobs.db_posts.create_post_variants", new_callable=AsyncMock) as mock_cv, \
         patch("cron.jobs.db_cells.mark_cell_rendered", new_callable=AsyncMock), \
         patch("cron.jobs.db_campaigns.get_autopilot_campaign_for_job", new_callable=AsyncMock) as mock_get_cam, \
         patch("cron.jobs.db_campaigns.get_campaign_persona", new_callable=AsyncMock) as mock_get_cp, \
         patch("cron.jobs.db_campaigns.create_campaign_persona_variants", new_callable=AsyncMock) as mock_link:
        mock_cad.return_value = [cadence]
        mock_count.return_value = 10
        mock_next.return_value = [planned_cell]
        mock_brand.return_value = {"custom_system_prompt": "brand"}
        mock_render.return_value = "body"
        mock_ci.return_value = {"id": "ci1"}
        mock_cv.return_value = [{"id": "v1", "platform": "linkedin"}]
        mock_get_cam.return_value = {"id": "cam1"}
        mock_get_cp.return_value = {"id": "cp1"}
        from cron.jobs import run_refill_and_schedule
        await run_refill_and_schedule(svc, per_cadence_limit=1)
    mock_link.assert_awaited_once()
    linked = mock_link.call_args[0]
    assert linked[1] == "cp1"               # campaign_persona_id
    assert linked[2][0]["post_variant_id"] == "v1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_refill_cron.py -k links_variant -v`
Expected: FAIL (`cron.jobs.db_campaigns` referenced in the patch but cron doesn't call these yet)

- [ ] **Step 3: Implement**

`worker/cron/jobs.py` already imports `from db import campaigns as db_campaigns`. In `_refill_one_cadence`, find the per-cell loop tail:

```python
        await db_posts.create_post_variants(
            svc,
            [
                {
                    "workspace_id": cell["workspace_id"],
                    "persona_id": persona_id,
                    "content_item_id": content_item["id"],
                    "platform": platform,
                    "body": body,
                    "status": variant_status,
                }
            ],
        )
        await db_cells.mark_cell_rendered(svc, cell["id"])
        rendered += 1
```

`create_post_variants` returns the inserted rows; capture them and link into the asset's campaign. Replace that block with:

```python
        created_variants = await db_posts.create_post_variants(
            svc,
            [
                {
                    "workspace_id": cell["workspace_id"],
                    "persona_id": persona_id,
                    "content_item_id": content_item["id"],
                    "platform": platform,
                    "body": body,
                    "status": variant_status,
                }
            ],
        )

        # Link the variant into the asset's autopilot campaign so it shows up in
        # the unified Campaigns UI. Defensive find-or-create: legacy cells from
        # before unification have no campaign yet.
        job_id = cell.get("ingestion_job_id")
        if job_id and created_variants:
            campaign = await db_campaigns.get_autopilot_campaign_for_job(svc, job_id)
            if campaign is None:
                campaign = await db_campaigns.create_campaign(
                    svc,
                    {
                        "workspace_id": cell["workspace_id"],
                        "ingestion_job_id": job_id,
                        "title": "Autopilot",
                        "kind": "autopilot",
                        "status": "pending_approval",
                    },
                )
                await db_campaigns.create_campaign_personas(
                    svc, campaign["id"], [persona_id]
                )
            cp = await db_campaigns.get_campaign_persona(
                svc, campaign["id"], persona_id
            )
            if cp:
                await db_campaigns.create_campaign_persona_variants(
                    svc,
                    cp["id"],
                    [
                        {"post_variant_id": v["id"], "platform": v["platform"]}
                        for v in created_variants
                    ],
                )

        await db_cells.mark_cell_rendered(svc, cell["id"])
        rendered += 1
```

> Note: `create_campaign_persona_variants` (campaigns.py:96) already tolerates a missing `prompt_version_id` (`v.get("prompt_version_id")`), so omitting it here is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_refill_cron.py -v`
Expected: PASS — the new test plus the 3 existing refill tests (they patch the same `db_campaigns` calls as no-ops via AsyncMock defaults where referenced; the existing tests don't assert linking, so they remain green because `get_autopilot_campaign_for_job` returns an AsyncMock that is truthy → no create path; confirm the 3 originals still pass).

> If an existing refill test fails because `create_post_variants`'s return value is now consumed, ensure those tests set `mock_cv.return_value = [{"id": "v1", "platform": "linkedin"}]` (the rendering test already does; the pending_approval test must too — add `"platform": "linkedin"` to its `mock_cv.return_value` if missing).

- [ ] **Step 5: Commit**

```bash
git add worker/cron/jobs.py worker/tests/test_refill_cron.py
git commit -m "feat(worker): refill cron links rendered variants into the asset's autopilot campaign"
```

---

## Phase 3 — Web: unified campaign UI (per-kind branch)

### Task 3.1: `kind` + correct, single-query counts in campaigns db layer

**Files:**
- Modify: `web/lib/db/campaigns.ts`
- Test: `web/tests/db.campaigns-kind.test.ts` (type-level, mirrors `db.ingestion.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `web/tests/db.campaigns-kind.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

describe("campaigns.kind type", () => {
  it("Row exposes kind", () => {
    type Row = Database["public"]["Tables"]["campaigns"]["Row"];
    const kind: Row["kind"] = "autopilot";
    expect(kind).toBe("autopilot");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test db.campaigns-kind`
Expected: FAIL only if types weren't regenerated; if Phase 0 ran, this passes immediately — that's fine, it's a guard. If it fails, re-run `pnpm --dir web gen:types`.

- [ ] **Step 3: Add `kind` to the list type and compute counts correctly in ONE query**

In `web/lib/db/campaigns.ts`, `CampaignListRow` and `listCampaignsForWorkspace` currently derive `pending_count` from `campaign_personas.approval_status`. Autopilot campaigns approve per-variant, so that count is wrong for them. Compute a per-campaign pending **variant** count in a single grouped query (no N+1), and surface `kind`.

Replace the `CampaignListRow` type and `listCampaignsForWorkspace` function with:

```typescript
export type CampaignListRow = CampaignRow & {
  persona_count: number
  pending_count: number
}

export async function listCampaignsForWorkspace(
  workspaceId: string,
  limit = 50
): Promise<CampaignListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, campaign_personas(approval_status)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const rows = (data ?? []) as Array<
    CampaignRow & { campaign_personas: Array<{ approval_status: string }> }
  >

  // For autopilot campaigns, "pending" means post_variants in pending_approval,
  // not pending personas. Fetch those counts for all autopilot campaigns in the
  // page in ONE query (grouped client-side), avoiding an N+1 per campaign.
  const autopilotIds = rows.filter(r => r.kind === 'autopilot').map(r => r.id)
  const pendingByCampaign = new Map<string, number>()
  if (autopilotIds.length > 0) {
    const { data: links, error: linkErr } = await supabase
      .from('campaign_persona_variants')
      .select('campaign_personas!inner(campaign_id), post_variants!inner(status)')
      .in('campaign_personas.campaign_id', autopilotIds)
      .eq('post_variants.status', 'pending_approval')
    if (linkErr) throw linkErr
    for (const row of (links ?? []) as Array<{ campaign_personas: { campaign_id: string } }>) {
      const cid = row.campaign_personas.campaign_id
      pendingByCampaign.set(cid, (pendingByCampaign.get(cid) ?? 0) + 1)
    }
  }

  return rows.map(row => {
    const { campaign_personas, ...rest } = row
    const personas = campaign_personas ?? []
    const pending =
      row.kind === 'autopilot'
        ? pendingByCampaign.get(row.id) ?? 0
        : personas.filter(p => p.approval_status === 'pending').length
    return {
      ...rest,
      persona_count: personas.length,
      pending_count: pending,
    }
  })
}
```

> Performance note: this is **two queries total** for the whole page (one for campaigns, one grouped fetch for all autopilot pending variants), regardless of how many campaigns. No per-campaign query.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --dir web test db.campaigns-kind && pnpm --dir web typecheck`
Expected: test PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/campaigns.ts web/tests/db.campaigns-kind.test.ts
git commit -m "feat(web): campaigns.kind + correct per-kind pending counts (single query, no N+1)"
```

### Task 3.2: Autopilot chip + low-fuel banner on the campaigns list

**Files:**
- Modify: `web/app/(app)/campaigns/page.tsx`

- [ ] **Step 1: Add the autopilot chip and relocate the low-fuel banner**

Edit `web/app/(app)/campaigns/page.tsx`. Add imports at the top:

```typescript
import { Inbox, ChevronRight, Zap } from "lucide-react";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCadencesForWorkspace, getReservoirForPersona } from "@/lib/db/content-engine";
import { LowFuelBanner, type LowFuelPlatform } from "@/components/app/LowFuelBanner";
```

(Remove the now-duplicated `Inbox, ChevronRight` import line; merge into the line above.)

After `const campaigns = await listCampaignsForWorkspace(...)`, compute the low-fuel platforms (same logic the review page used):

```typescript
  const cadences = await getCadencesForWorkspace(workspace.workspace_id);
  const activeCadences = cadences.filter((c) => c.active);
  const reservoirs = await Promise.all(
    activeCadences.map((c) => getReservoirForPersona(c.persona_id, c.platform))
  );
  const low: LowFuelPlatform[] = activeCadences.flatMap((c, i) =>
    reservoirs[i] < c.low_reservoir_threshold
      ? [{ platform: c.platform, reservoir: reservoirs[i], threshold: c.low_reservoir_threshold }]
      : []
  );
```

Render `<LowFuelBanner low={low} />` directly under the page header `</div>` (before the `campaigns.length === 0` block). And in the campaign `<li>`, add the autopilot chip next to the title:

```tsx
                  <p className="truncate text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    {c.kind === "autopilot" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">
                        <Zap className="h-2.5 w-2.5" /> Autopilot
                      </span>
                    )}
                    {c.title?.trim() || "Untitled campaign"}
                  </p>
```

- [ ] **Step 2: Typecheck + lint + test**

Run: `pnpm --dir web typecheck && pnpm --dir web test`
Expected: clean / all pass.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/campaigns/page.tsx"
git commit -m "feat(web): autopilot chip + low-fuel banner on campaigns list"
```

### Task 3.3: Per-post review island for autopilot campaigns

**Files:**
- Create: `web/app/(app)/campaigns/[id]/_components/AutopilotVariantList.tsx`
- Modify: `web/app/(app)/campaigns/[id]/_components/CampaignReview.tsx`

- [ ] **Step 1: Create the per-post island**

This is the Review Queue's per-post UX, relocated and reading from the campaign's variants. Create `web/app/(app)/campaigns/[id]/_components/AutopilotVariantList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";

export interface AutopilotVariant {
  id: string;
  platform: string;
  body: string;
  status: string;
  format: string | null;
  angle: string | null;
}

const PLATFORM_LABEL: Record<string, string> = { linkedin: "LinkedIn", x: "X / Twitter" };

export function AutopilotVariantList({ initial }: { initial: AutopilotVariant[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = items.filter((v) => v.status === "pending_approval");

  async function review(id: string, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      setItems((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, status: action === "approve" ? "draft" : "cancelled" } : v
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    for (const v of pending) await review(v.id, "approve");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {pending.length} of {items.length} awaiting approval
        </p>
        {pending.length > 0 && (
          <button
            onClick={approveAll}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Approve all
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {items.map((v) => (
        <div key={v.id} className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
              {PLATFORM_LABEL[v.platform] ?? v.platform}
            </span>
            {v.format && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {v.format.replace(/_/g, " ")}
              </span>
            )}
            {v.angle && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {v.angle}
              </span>
            )}
            <span className="ml-auto rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
              {v.status}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{v.body}</p>
          {v.status === "pending_approval" && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => review(v.id, "approve")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                onClick={() => review(v.id, "reject")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Branch CampaignReview on `kind`**

At the top of `CampaignReview`'s render (in `CampaignReview.tsx`), before the existing per-persona markup, add an early branch. First add the import:

```typescript
import { AutopilotVariantList, type AutopilotVariant } from "./AutopilotVariantList";
```

Then, inside the component body (after `const [campaign, setCampaign] = useState(initial);`), add:

```typescript
  // Autopilot campaigns review per-post, not per-persona. Flatten the single
  // persona's variants (the deep join already nested them) into the per-post view.
  if (campaign.kind === "autopilot") {
    const variants: AutopilotVariant[] = campaign.campaign_personas.flatMap((cp) =>
      cp.variants.map((v) => ({
        id: v.post_variant_id,
        platform: v.platform,
        body: v.body,
        status: v.status,
        format: null,
        angle: null,
      }))
    );
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            {campaign.title?.trim() || "Autopilot"}
          </h1>
          <p className="text-xs text-slate-400">Posts the engine generated from this asset.</p>
        </div>
        <AutopilotVariantList initial={variants} />
      </div>
    );
  }
```

> `campaign.kind` requires the `CampaignWithPersonas` type to include `kind`. Since `CampaignWithPersonas = CampaignRow & {...}` and `CampaignRow` now has `kind` (from regenerated types), it's already present — no type change needed. `format`/`angle` are set to `null` here; surfacing them is a deferred polish (see plan tail) since the existing campaign join doesn't fetch content_items metadata. The status badge + body are the load-bearing parts.

- [ ] **Step 3: Typecheck + lint + test**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`
Expected: clean / all pass (no lint errors in the two new/edited files).

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/_components/"
git commit -m "feat(web): per-post review for autopilot campaigns (CampaignReview branches on kind)"
```

---

## Phase 4 — Cleanup: delete everything the Review Queue orphaned

> This phase is mandatory, not optional. The grep in Task 4.2 is the proof that nothing dead is left behind.

### Task 4.1: Delete the Review Queue page, island, db helper, and nav item

**Files:**
- Delete: `web/app/(app)/review/page.tsx`, `web/app/(app)/review/_components/ReviewList.tsx`
- Modify: `web/lib/db/content-engine.ts` (remove `listPendingApprovalVariants` + `PendingApprovalVariant`)
- Modify: `web/components/app/Sidebar.tsx` (remove the "Review" item)

- [ ] **Step 1: Delete the review page + island**

```bash
git rm "web/app/(app)/review/page.tsx" "web/app/(app)/review/_components/ReviewList.tsx"
```

(If the `review/` directory is now empty, git removes it automatically.)

- [ ] **Step 2: Remove the dead db helper**

In `web/lib/db/content-engine.ts`, delete the `PendingApprovalVariant` type and the `listPendingApprovalVariants` function (lines 37–59 — the block starting at the `// Post variants awaiting batch approval` comment through the end of the function). Also remove the now-unused `ContentItemRow` and `PostVariantRow` type aliases at the top **only if** nothing else in the file uses them (the remaining `getReservoirForPersona`/`getCadencesForWorkspace` use neither `PostVariantRow` nor `ContentItemRow` except via the deleted type — verify and remove the orphaned aliases).

- [ ] **Step 3: Remove the "Review" nav item**

In `web/components/app/Sidebar.tsx`, remove the `{ name: "Review", href: "/review", icon: CheckCheck }` line and remove `CheckCheck` from the lucide import.

- [ ] **Step 4: Typecheck — proves nothing still imports the deleted code**

Run: `pnpm --dir web typecheck`
Expected: clean. A failure here means something still references the deleted page/helper — fix the caller (it should only have been the deleted review page).

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/content-engine.ts web/components/app/Sidebar.tsx
git commit -m "refactor(web): delete standalone Review Queue (unified into campaigns)"
```

### Task 4.2: Dead-code sweep — grep-verify zero orphans

**Files:** none (verification task)

- [ ] **Step 1: Verify no references to the deleted symbols remain**

Run:
```bash
grep -rn "listPendingApprovalVariants\|PendingApprovalVariant\|ReviewList\|/review\b\|href=\"/review\"" web/app web/lib web/components
```
Expected: **no matches** (an empty result). If anything appears, it's a leftover reference — remove it.

- [ ] **Step 2: Confirm the kept symbols are still referenced (not accidentally orphaned)**

Run:
```bash
grep -rn "workerReviewPost\|posts/\[id\]/review\|LowFuelBanner\|getReservoirForPersona\|getCadencesForWorkspace" web/app web/lib web/components
```
Expected: `workerReviewPost` used by the review proxy route; `/posts/[id]/review` route present; `LowFuelBanner` used by campaigns list + autopilot settings; reservoir/cadence helpers used by both. If any of these has **zero** non-definition references, it became dead — re-evaluate whether to delete it too.

- [ ] **Step 3: Worker dead-code check**

Run:
```bash
grep -rn "pending_approval" worker/ | grep -v test
```
Expected: still referenced by the refill cron (`variant_status`) and the `/posts/{id}/review` route — both kept. Confirms the worker review path is still live.

- [ ] **Step 4: No commit needed** (verification only). If Steps 1–3 surfaced fixes, commit them:

```bash
git add -A && git commit -m "refactor: remove residual Review Queue references"
```

---

## Phase 5 — Full verification

### Task 5.1: Performance check — no N+1 on the campaigns list

- [ ] **Step 1: Confirm the list query is O(1) in number of campaigns**

Read `web/lib/db/campaigns.ts::listCampaignsForWorkspace` and confirm: exactly **two** Supabase calls total (campaigns + the single grouped `campaign_persona_variants` fetch), with **no query inside a `.map`/loop over campaigns**. This is the explicit performance gate.
Expected: no `await` inside any loop over campaigns; the pending-variant counts come from one `.in_(...)` query.

### Task 5.2: Full-stack green

- [ ] **Step 1: Worker suite**

Run: `cd worker && uv run pytest -q`
Expected: all pass.

- [ ] **Step 2: Web typecheck + test + lint**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`
Expected: typecheck clean, tests pass; lint shows no NEW errors in changed files (4 pre-existing issues in untouched files may remain).

### Task 5.3: Manual smoke (needs both services)

- [ ] **Step 1: End-to-end**

With both services running:
1. Chat → ingest an asset → **Atomize into queue** → confirm a new **Autopilot** campaign appears in Campaigns.
2. Set a cadence with autopilot OFF → POST `/cron/refill-and-schedule` → confirm rendered posts appear **inside that campaign** as `pending_approval`, with the per-post Approve/Reject UI.
3. Approve one → it becomes `draft`; reject one → `cancelled`. Re-atomize the same asset → confirm **no duplicate** campaign is created.
4. Confirm a **manual** campaign still looks/behaves exactly as before (per-persona approval).
5. Confirm the "Review" nav item is gone and the low-fuel banner shows on the Campaigns list when a cadence is low.

---

## Deferred polish (note, do not build now)

- **Surface format/angle on autopilot variant cards.** Task 3.3 sets them to `null` because the existing campaign deep-join (`getCampaignWithPersonas`) doesn't fetch `content_items.format/angle`. Adding them means extending that join's select. Low value (status + body carry the review), so deferred — note in `Future improvements/autonomous_content_engine_deferred.md` if you want it tracked.
- **Backfill orphaned pre-unification autopilot variants** into campaigns (spec §7) — only if real test-data orphans exist.

---

## Notes for the executor

- Do NOT hand-edit `web/lib/db/types.ts` — only via `pnpm gen:types`.
- Branch is `feat/unify-autopilot-campaigns` (already created). Don't push to `main`.
- The `/posts/{id}/review` worker route, its web proxy, and `workerReviewPost` are **kept** — they move from the Review Queue to the autopilot campaign view. Don't delete them.
- If a grep/verification step reveals a real signature different from this plan, use the real one (the plan's intent — reuse the existing join, single-query counts, delete only what's truly dead — is what matters).
