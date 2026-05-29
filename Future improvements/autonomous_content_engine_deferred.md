# Autonomous Content Engine — Deferred Items (for next versions)

> Companion to the main design spec: `docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md`.
> These are ideas considered during the 2026-05-30 brainstorm that we deliberately **deferred** so the
> first version of the Autonomous Content Engine stays shippable and focused. Each entry says *why* it was
> deferred and *what trigger* should make us revisit it. Do not lose these.

---

## D1 — Smart reservoir ordering / engagement-predicted ranking
**What:** Instead of the v1 simple ordering (round-robin across ideas, varied formats, oldest-asset-first),
rank which planned post to render-and-schedule next by a *predicted quality / engagement score*.

**Why deferred:** High complexity, low value *today*. We have almost no per-workspace engagement data, so a
"predictive" ranker would rank on noise — the same reasoning as V3.7/V3.8 in `SOCIALOS_V2_PLAN.md`.

**Revisit when:** A workspace has 60+ days of engagement data across enough published variants for the signal
to beat noise. The architecture already leaves a clean seam: the refill cron asks an `order_planned_posts()`
function for the next batch — swap the implementation, nothing else changes.

---

## D2 — Auto-generated visual assets (cards, slide carousels)
**What:** Generate designed image cards and multi-slide carousels alongside the text, not just reuse scraped
media. (Proposed in `Future improvements/brainstorming_proposal.md` Pillar 3.)

**Why deferred:** Separate, heavy workstream (image rendering/templating + storage + per-platform sizing).
Orthogonal to the atomization wedge. The existing media pipeline (Cloudinary, 4-asset cap) already attaches
*scraped/uploaded* images, which covers v1. AI image gen is also a hard "no" for V2/V3 in the V2 plan (cost).

**Revisit when:** Text-only atomized posts show measurably weak engagement, OR a paying user explicitly asks.
Start with *templated* cards (deterministic, cheap) before any generative imagery.

---

## D3 — Narrative campaign blueprints (sequenced multi-day arcs)
**What:** A special atomization *shape* where one asset becomes an ordered narrative — e.g. Day 1 teaser →
Day 5 launch → Day 8 deep-dive — rather than independent matrix cells. (Proposed in
`brainstorming_proposal.md` Pillar 1.)

**Why deferred:** The matrix (idea × format × angle × platform) is the reliable, defensible core and ships
first. Narrative sequencing adds ordering/dependency logic (post N assumes post N-1 went out) that complicates
the reservoir/cadence model. It is a *mode on top of* the matrix, not a replacement.

**Revisit when:** The matrix engine is solid and users ask for "launch campaign" style sequencing. Implement
as a `blueprint` flag on a batch that pins relative ordering + spacing, draining the same reservoir.

---

## D4 — Optional reservoir top-up sources (pillars, source-watching, trends)
**What:** Auto-refill the reservoir from sources other than user-uploaded assets:
- **Pillars:** user defines 3–5 content pillars; engine generates fresh on-brand posts within them when the
  reservoir runs low.
- **Source-watching:** connect blog/RSS/Notion/Drive; new content auto-atomizes into the reservoir.
- **Trends:** draft timely posts from what's trending in the user's niche.

**Why deferred:** v1's honest model is "user supplies a reservoir; we nudge before it runs dry." These are all
*additional inflows* to the same reservoir — the architecture (cron checks level → tops up) is already built
to accept them, so adding each later is low-risk.

**Revisit order:** Pillars first (no new integrations, just prompting), then source-watching (reuses the
planned V2 MCP Drive/Notion connectors), then trends (highest tone/brand risk — needs strong filtering).

---

## D5 — In-AI iterative co-authoring on a planned post
**What:** "Make this punchier / shorten the intro" conversational editing of a generated post, instead of
manual text edits or full regenerate. (Proposed in `brainstorming_proposal.md`.)

**Why deferred:** Nice polish, not load-bearing for "set it once." The existing regenerate path covers the
80% case. Adds chat-state + diff UX per post.

**Revisit when:** Approve-the-batch review shows users frequently hand-editing — that's the signal that guided
editing would save them real time.

---

## D7 — Hybrid matrix expansion (eager preview batch + lazy rest)
**What:** v1 expands the matrix *lazily* — ideas are extracted up front (cheap), but planned posts are rendered
into full text just-in-time as the refill cron drains the reservoir. The upgrade: eagerly render a *small
preview batch* so batch-approval review and onboarding feel instant, while still expanding the bulk lazily.

**Why deferred:** Lazy-only is the cheapest correct default and avoids burning LLM tokens on posts a user might
kill or never reach. At review time v1 shows planned *cells* (idea essence + format + angle + platform, from the
cheap extract pass) as a preview, rendering full text just-in-time.

**Revisit when:** Batch-approval UX feedback shows users want to see finished text for the whole batch before
approving. Render the first N cells eagerly, keep the rest lazy.

---

## D8 — User-configurable format/angle mix
**What:** Let users choose which post formats they want in their queue ("only how-tos and hot takes").

**Why deferred:** Cuts against "set it once" — v1 lets the LLM pick best-fit formats/angles per idea
automatically. Adds setup surface.

**Revisit when:** Users ask for more control over the *style* of their auto-generated queue.

---

## D6 — Learning loop: feed engagement back into idea/format selection
**What:** Close the loop — measure which ideas/formats/angles/platforms actually performed, and bias future
matrix expansion + ordering toward winners.

**Why deferred:** Depends on D1's data volume and is the analytical half of the wedge (same logic as the V2
plan deferring prompt-performance correlation to V3). Build the data capture in v1 (we already record which
`(idea, format, angle, platform)` cell each variant came from + metrics flow), expose the learning later.

**Revisit when:** Enough closed-loop data exists (post → metrics → attributed back to matrix cell) to compute
per-cell performance with statistical confidence.
