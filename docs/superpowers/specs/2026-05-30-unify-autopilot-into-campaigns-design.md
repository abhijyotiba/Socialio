# Unify Autopilot Review into Campaigns — Design Spec

**Date:** 2026-05-30
**Status:** Approved for planning
**Context:** Follow-up to the Autonomous Content Engine
(`docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md`).

---

## 1. Problem

The content engine shipped a standalone **Review Queue** (`/review`) for autopilot-OFF posts awaiting
approval. But the app already had a **Campaigns** review UI (`/campaigns/[id]`) that does the same *conceptual*
job — show AI-generated posts, approve/reject/schedule them — and is far richer (refine, revision history,
media picker, per-variant scheduling, realtime). Two "approve your AI posts" surfaces is confusing UX.

**Why they weren't already one:** engine posts have **no campaign**. The refill cron creates a bare
`content_item` + `post_variant` with no `campaign`/`campaign_persona` wrapper, so they can't appear in the
campaign UI. The Review Queue exists only because of that gap.

**Decision:** consolidate. Give engine batches the campaign wrapper, evolve the campaign UI to render them, and
delete the standalone Review Queue.

---

## 2. Three load-bearing decisions (settled in brainstorm)

1. **Campaign unit = one per atomized asset.** "Atomize into queue" creates one campaign for that asset; all
   posts the engine later renders from that asset's ideas land in it. This makes the autopilot flow
   structurally identical to the manual flow ("one source → one campaign → variants"). Shared key:
   `ingestion_job_id` (campaigns, content_ideas, and planned cells all reference it).

2. **Approval = per-post status, not per-persona.** A continuous stream has no "everything generated, approve
   once" moment, so the terminal per-persona model (`campaign_personas.approval_status`) is mechanically
   incompatible. Instead, approval lives on `post_variants.status` (`pending_approval` / `draft` / `scheduled`
   / …), which **the engine already sets**. The campaign is a *living container* showing status counts; new
   posts arriving hourly are just new `pending_approval` variants.

3. **Merge target = the existing Campaigns UI**, branched on a new `kind` field. Manual campaigns are
   untouched (zero regression risk); autopilot campaigns get a per-post review view. The standalone Review
   Queue is deleted.

---

## 3. Data model changes

One migration + `pnpm gen:types` (per CLAUDE.md §B.7). Latest migration is `0021`, so this is `0022`.

1. **ALTER `campaigns`**: add `kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','autopilot'))`.
   Existing rows default to `'manual'` — no behavior change for them.
2. No other schema changes. Autopilot reuses `campaign_personas` + `campaign_persona_variants` as-is.

---

## 4. Backend changes (worker)

### 4.1 Atomize creates the autopilot campaign (idempotent)

In `routes/content_engine.py::run_atomize`, after ideas are saved and cells materialized, **find-or-create**
the autopilot campaign for this `ingestion_job_id` + `persona_id`:

- If a `campaign` with `kind='autopilot'` already exists for this `ingestion_job_id`, reuse it (re-atomizing
  the same asset must not create a duplicate campaign).
- Else create: `campaigns` row `{ workspace_id, ingestion_job_id, title=<asset title>, kind='autopilot',
  status='pending_approval' }`, plus **one** `campaign_personas` row for `persona_id` (its `approval_status`
  is irrelevant for autopilot — the UI reads variant status — but the row is needed for the
  `campaign_persona_variants` join).
- No new column is needed to find the campaign_persona later: the cron looks it up by `(campaign_id,
  persona_id)`, and the campaign by `(ingestion_job_id, kind='autopilot')`.

New db helpers in `worker/db/campaigns.py`: `get_autopilot_campaign_for_job(client, ingestion_job_id)` (returns
the campaign or None) and `get_campaign_persona(client, campaign_id, persona_id)`; reuse existing
`create_campaign` / `create_campaign_personas` / `create_campaign_persona_variants`.

### 4.2 Refill cron attaches each rendered variant to the asset's campaign

In `cron/jobs.py::_refill_one_cadence`, the cell carries `ingestion_job_id` — **verified**: `run_atomize`
stores it on each materialized cell (`content_engine.py:61`) and `next_planned_cells` selects `*`
(`content_cells.py:49`), so it's already on the cell dict the cron receives. After `create_post_variants`:

1. Look up the autopilot campaign + its `campaign_persona` for `(ingestion_job_id, persona_id)`.
   - Defensive: if none exists (e.g. legacy planned cells from before this change), create it on the fly via
     the same find-or-create as 4.1.
2. Insert one `campaign_persona_variants` row linking the new variant — the **same join the manual flow uses**
   (`campaigns.py:219`). ~5 lines.

The variant's `status` (`draft` for autopilot-ON, `pending_approval` for OFF) is unchanged — that stays the
source of truth for per-post approval.

### 4.3 Approve/reject endpoint — unchanged

The `/posts/{id}/review` worker route (approve → `draft`, reject → `cancelled`) **stays exactly as built**. It
already operates per-post, which is precisely what autopilot campaigns need. Only its *web caller* moves.

---

## 5. Web changes

### 5.1 Campaigns list (`app/(app)/campaigns/page.tsx`)

- Autopilot campaigns appear alongside manual ones.
- Add an "Autopilot" chip + ⚡ icon when `kind='autopilot'`.
- Status line shows per-variant counts for autopilot campaigns ("8 approved · 3 pending · 2 scheduled")
  rather than the per-persona pending count used for manual.

### 5.2 Campaign detail (`CampaignReview.tsx`) — branch on `kind`

- **`kind='manual'`** → unchanged. Existing `PersonaGroup` / per-persona approval. No regression.
- **`kind='autopilot'`** → render a **per-post list**: each variant with its status badge + matrix metadata
  (format/angle), Approve / Reject per post, and Approve-all-pending. Approve/Reject call the existing
  `/api/posts/{id}/review` proxy. Reuse the per-variant-capable pieces (Refine, media, schedule, revision
  history) since those already operate per-variant.
- Extract the per-post rendering into a focused component (e.g. `AutopilotVariantList`) used only by the
  autopilot branch; the manual branch keeps `PersonaGroup`.

### 5.3 Delete the standalone Review Queue

- Delete `app/(app)/review/page.tsx`, `app/(app)/review/_components/ReviewList.tsx`.
- Remove the "Review" item from `components/app/Sidebar.tsx`.
- Remove `listPendingApprovalVariants` from `lib/db/content-engine.ts` (or fold its query into the campaign
  detail's data fetch).
- **Keep** the `/posts/{id}/review` worker route + `web/app/api/posts/[id]/review/route.ts` proxy +
  `workerReviewPost` helper — now called from the campaign detail.

### 5.4 Low-fuel banner — relocate, don't lose

The `LowFuelBanner` currently renders on the Review Queue and the Autopilot settings page. The Review Queue
instance moves to the **Campaigns list page** (top of `campaigns/page.tsx`). The Autopilot settings instance
stays. Reuse the existing `getCadencesForWorkspace` + `getReservoirForPersona` computation.

---

## 6. What is explicitly NOT changing

- Manual campaign generation + per-persona approval — untouched.
- The atomization matrix, reservoir/cadence model, refill cron's render logic — untouched (only +5 lines to
  link variants to a campaign).
- The `/posts/{id}/review` worker contract — untouched.
- Downstream publish/schedule/metrics — untouched.

---

## 7. Migration of existing data

If any autopilot posts already exist (from manual testing) as campaign-less `post_variants` with
`status='pending_approval'`, they will simply not appear in any campaign after this change. Options:
- **Accepted for v1:** this is a brand-new feature with no production data; a one-off cleanup (or ignoring the
  orphans) is fine. The defensive find-or-create in the cron (4.2) means *future* renders always get a
  campaign. No data migration script required. (If real orphans exist, a tiny backfill can group them by
  `ingestion_job_id` into campaigns — note as optional follow-up, not v1 scope.)

---

## 8. Success criteria

1. Atomizing an asset creates exactly one `kind='autopilot'` campaign for it (re-atomizing reuses it).
2. The refill cron's rendered variants appear inside that campaign in the Campaigns UI.
3. Autopilot campaign detail shows per-post status with working Approve / Reject / Approve-all (via the
   existing review route); approving moves a post to `draft` (publishable), rejecting to `cancelled`.
4. Manual campaigns look and behave exactly as before (no regression).
5. The standalone `/review` page, its island, and the "Review" nav item are gone; the low-fuel banner still
   appears (Campaigns list + Autopilot settings).
6. `pnpm typecheck` + `pnpm test` (web) and `pytest` (worker) green.
