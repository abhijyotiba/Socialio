# Autonomous Content Engine — Design Spec

**Date:** 2026-05-30
**Status:** Approved for planning
**Scope:** Content Engine only (Growth Operator = future layer 2, designed with clean seams)
**Deferred items:** `Future improvements/autonomous_content_engine_deferred.md`

---

## 1. The product, in one paragraph

SocialOS becomes an **autonomous content engine**. The user sets up their brand voice once, drops in a few
substantial assets (a *reservoir*), and picks a *cadence*. The engine runs an **atomization matrix** —
extracting atomic ideas from each asset, then crossing them with `format × angle × platform` to produce a
large set of genuinely distinct, on-brand, platform-native posts, with **de-duplication** so nothing repeats.
It schedules them across the cadence, optionally gates them behind a one-screen **batch approval** (or runs
**full autopilot** via a toggle), publishes via the existing pipeline, and **monitors the reservoir level** —
nudging the user to feed it more *before* the queue runs dry.

**The defensible wedge** is not "AI writes posts" (commodity). It is:
1. The **structured atomization matrix** that turns one asset into weeks of non-repetitive posts a human would
   be proud of (varied by idea, format, angle, and platform — by construction, not by luck).
2. The **set-it-once reservoir + cadence autopilot** with a proactive low-fuel nudge.
3. Both sit on the existing **brand-voice + versioned-prompt** system, so every post is unmistakably that
   brand's voice.

**Why this engine (vs. alternatives):** atomization is the only idea-source that is *deterministic and
reliable*. "User gave me a 3,000-word transcript → I can guarantee ~40 quality posts" is a promise we can keep
on day one. Pillars get repetitive, source-watching starves on quiet days, trend-watching is a tone minefield.
Those become optional *reservoir top-up* inflows later (see deferred D4).

---

## 2. Core conceptual model

Four nouns. Three already exist; one is new; two are enriched.

| Noun | Maps to | Change |
|---|---|---|
| **Asset** | `ingestion_jobs` | Unchanged. A source the user dropped in (URL/transcript/PDF/idea), already extracted to text. |
| **Idea** | `content_ideas` (**NEW**) | Output of the new *Extract-Ideas* pass: atomic claims/stats/stories/frameworks mined from an asset. The raw material the matrix multiplies. |
| **Planned post** | `content_items` (**enriched**) | One `(idea × format × angle × platform)` matrix cell. Gains `idea_id`, `format`, `angle`, `platform`, `matrix_cell_hash`. |
| **Variant** | `post_variants` | Unchanged. The final platform-native rendered text → schedule → publish → metrics. |

**Data flow:**

```
Asset ──[Extract Ideas]──▶ Ideas ──[Matrix expand + dedupe]──▶ Planned posts ──[Render platform-native]──▶ Variants ──▶ (existing) schedule ▶ publish ▶ metrics
        NEW stage                   NEW stage                    extends generate.py     UNCHANGED downstream
```

Only **two new pipeline stages**: Extract-Ideas and Matrix-expand/Render. Everything from `post_variants`
onward (idempotency, `FOR UPDATE SKIP LOCKED` claim, publish-due cron, metrics pull) is reused as-is.

---

## 3. The two new pipeline stages (worker)

Both live in the worker (where all LLM work lives) and reuse `worker/adapters/llm.py::generate()`.

### 3.1 Stage A — Extract-Ideas (`worker/pipeline/atomize.py`, NEW)

- **Input:** asset's extracted text + brand context.
- **One structured-output LLM call** returns a JSON array of atomic ideas. Each idea:
  ```json
  {
    "essence": "one-line statement of the idea",
    "idea_type": "stat | story | claim | framework | lesson",
    "source_quote": "verbatim snippet from the asset that grounds this idea",
    "strength": 1-5,
    "suitable_formats": ["hot_take", "how_to", ...],
    "suitable_angles": ["beginner", "expert", ...]
  }
  ```
- **`source_quote` is the anti-fabrication anchor** (addresses V2 plan §6.8 hallucination risk). Every
  rendered post is grounded in a real snippet; we never invent stats.
- **`suitable_formats`/`suitable_angles`** = the LLM picks best-fit cells for each idea (a dry stat → "stat
  callout"/"myth-buster", not "personal story"). This is what keeps outputs from feeling like forced machine-shred.
- Persisted to `content_ideas`. The idea count × suitable cells is the **honest reservoir estimate** shown to
  the user ("this asset ≈ 24 posts").

### 3.2 Stage B — Render planned post (extends `worker/pipeline/generate.py`)

- **Input:** one `(idea, format, angle, platform)` cell.
- **Targeted prompt** (replaces the naive single-summary prompt):
  > "Write a `{platform-native hint}` in the form of a `{format}`, aimed at `{angle}`, expressing this idea:
  > `{essence}`, grounded in: `{source_quote}`. Brand voice: `{system_prompt}`."
- Output is a finished `post_variant` body. Because each cell is a distinct combination, variety is structural,
  not luck-dependent.
- **Format vocabulary** (fixed enum, 6): `hot_take`, `how_to`, `personal_story`, `question`, `myth_buster`,
  `thread`.
- **Angle vocabulary** (fixed enum, ~4): `beginner`, `expert`, `contrarian`, `practical`. Defined in one
  constants module so the matrix is bounded and predictable.

### 3.3 De-duplication (between A and B)

- Before rendering, compute `matrix_cell_hash = hash(idea_id, format, angle, platform)`.
- A **DB uniqueness constraint** on `content_items.matrix_cell_hash` guarantees the same cell is never rendered
  twice. "Never repeats itself" is enforced in the schema, not by AI judgment.

### 3.4 Expansion timing: **lazy render, eager materialize**

Two distinct steps, deliberately split so the reservoir count stays cheap and consistent:

1. **Materialize cells (eager, cheap, no LLM):** right after Extract-Ideas, the engine enumerates the best-fit
   `(idea × format × angle × platform)` cells and inserts a lightweight `content_items` row for each — matrix
   metadata + `matrix_cell_hash` + `status = 'planned'` + **empty body**. No LLM call. This is what makes the
   reservoir count (= unscheduled planned rows) honest and instant.
2. **Render bodies (lazy, LLM):** the refill cron renders the body text **just-in-time** as it drains the
   reservoir — `status: planned → rendered` — so we only spend LLM tokens on posts that will actually be used.

At batch-review time, the preview shows the materialized cells (essence + format + angle + platform); body text
renders just-in-time on drain. Eager body-render of a preview batch = deferred D7.

---

## 4. Reservoir, cadence & autopilot loop

### 4.1 Reservoir = computed state (not a table)

Reservoir level = count of `content_items` (planned cells) that are generated-but-not-yet-scheduled/published
for a persona+platform. Atomizing an asset fills it; the cadence drains it.

### 4.2 Cadence (`content_cadences`, NEW — one row per persona+platform)

| Column | Purpose |
|---|---|
| `persona_id`, `platform` | Scope. |
| `posts_per_week` | Drain rate. |
| `autopilot_enabled` | The toggle: `true` = full autopilot, `false` = batch-approve gate. Default `false`. |
| `active` | Pause/resume. |
| `low_reservoir_threshold` | Default ≈ 5 days of runway. |

This table **is** the "set it once" config.

### 4.3 Autopilot loop (`refill-and-schedule` cron, NEW — alongside existing crons)

For each `active` cadence:
1. Check reservoir level.
2. If `planned` cells exist **and** open schedule slots exist in the window → render the next-best `planned`
   cells (body text via Stage B; `planned → rendered`), create `post_variants`, assign to slots via existing
   `posting_schedules`, then:
   - `autopilot_enabled` → mark schedule-eligible (existing publish-due cron takes over);
   - else → mark `pending_approval` (the gate); surface in the batch-review screen.
3. If reservoir level < `low_reservoir_threshold` → fire the **low-fuel nudge**: in-app banner + email
   ("Your LinkedIn queue runs dry in 4 days. Feed me an asset."). Reuses the V2 failure-notification pattern.
4. If reservoir empty and optional top-up sources exist (pillars/source-watch — *deferred D4*) → pull from
   them. For v1: just nudge.

### 4.4 Ordering: **simple for v1**

"Next-best planned posts" = round-robin across ideas, varied formats, oldest-asset-first. No engagement-based
ranking yet (we lack data; would rank on noise). Clean seam: the cron calls `order_planned_posts()` — swap the
impl later. Smart ranking = deferred D1.

### 4.5 Growth-layer seam

The loop pattern (cron → check state → act → notify) is exactly what the future engagement/outreach agent
needs. We build the loop chassis once here.

---

## 5. Build approach

**Approach 1 — Extend the existing campaign pipeline. (CHOSEN.)**
Reuse `ingestion_jobs` → add `content_ideas` + `content_cadences` → enrich `content_items` with matrix columns
→ reuse `post_variants`/scheduling/cron/metrics. New `worker/pipeline/atomize.py`; render extends
`generate.py`; new `refill-and-schedule` cron alongside existing ones.

- **Pros:** Maximum reuse; battle-tested downstream untouched; matches every CLAUDE.md convention.
- **Cons:** Touches central `content_items` (needs careful migration + `pnpm gen:types`).

**Rejected — Approach 2 (parallel `engine_*` tables):** duplicates existing concepts, two models to sync.
**Rejected — Approach 3 (prompt-only mega-call):** this *is* the repetitive-mush failure mode we design against.

---

## 6. Schema changes (all in one migration + `gen:types`, per CLAUDE.md §Schema changes)

1. **NEW `content_ideas`**: `id`, `workspace_id`, `ingestion_job_id`, `essence`, `idea_type`, `source_quote`,
   `strength`, `suitable_formats jsonb`, `suitable_angles jsonb`, `created_at`. RLS enabled (workspace-scoped).
2. **NEW `content_cadences`**: columns per §4.2. RLS enabled. Unique on `(persona_id, platform)`.
3. **ALTER `content_items`**: add `idea_id` (FK → content_ideas, nullable for legacy rows), `format`, `angle`,
   `platform`, `matrix_cell_hash` (unique, nullable for legacy rows).
4. RLS enabled on every new table (no exceptions). Brand prompts stay versioned — atomize/render reference the
   `prompt_version_id` they used.

---

## 7. Web surface (thin, per architecture)

- **Setup ("set it once"):** brand voice (exists) + asset drop (exists) + a small **cadence** form
  (posts/week, platforms, autopilot toggle, pause). Thin proxy → worker.
- **Batch-review screen:** lists `pending_approval` planned posts for a persona; approve-all / kill / edit
  individual. Read via `lib/db/*` under RLS; mutations are thin proxies to the worker.
- **Reservoir indicator:** shows estimated runway ("≈ 8 days of posts left") + the low-fuel nudge banner
  (reuses existing banner pattern).
- All mutations = worker endpoints first, web routes are proxies. All reads favor Server Components.

---

## 8. What v1 explicitly does NOT include (deferred — see deferred doc)

Smart/engagement ranking (D1), AI/visual cards & carousels (D2), narrative campaign blueprints (D3), pillar/
source-watch/trend top-up inflows (D4), in-AI iterative co-authoring (D5), engagement learning loop (D6), eager
preview batch (D7), user-configurable format mix (D8). The **Growth Operator** (layer 2) is out of scope
entirely; only its loop seam is reserved.

---

## 9. Success criteria

1. A user can: set brand once + drop one substantial asset + set a cadence → the engine extracts ideas,
   the reservoir shows an honest estimate, and posts begin appearing in the queue at the cadence.
2. Posts from one asset are *visibly distinct* (different ideas, formats, angles, platform-native) — no two
   share a `matrix_cell_hash`.
3. Autopilot toggle works: ON → posts go to publish-eligible; OFF → posts wait in batch-review.
4. When the reservoir falls below threshold, the user gets a low-fuel nudge *before* the queue empties.
5. Every generated post is grounded in a real `source_quote` (no fabricated stats).
6. Downstream (schedule/publish/idempotency/metrics) behavior is unchanged.
7. `pnpm typecheck` + `pnpm test` (web) and `pytest` (worker) green.
