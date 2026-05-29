# Spine Hardening — Design Spec

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Scope:** Make the one core content path excellent end-to-end. No new features.

---

## 1. Problem

The product has the page surface of a mature social-media tool (chat, campaigns, queue,
dashboard, settings) but the one feature that matters — the content **spine** — is
simultaneously slow, confusing, error-prone, and visually unpolished. Adding more features
(calendar, analytics, repurposing — the competitor wishlist) onto an unstable base would
produce more half-working surface, not a usable product.

**Decision:** perfect the spine first. The competitor feature list becomes the *earned
backlog*, not this pass.

The spine is:

```
idea / URL  →  generate  →  review  →  schedule / publish
```

### Concrete defects found in the current code

1. **The review surface forks, and one fork is broken.**
   - Single-persona generation renders an actionable inline `VariantCard`
     (`web/app/(app)/chat/_components/VariantCard.tsx`, 553 lines) with full
     publish / schedule / refine / revision-history / media controls.
   - Multi-persona generation routes to `/campaigns/[id]`
     (`web/app/(app)/campaigns/[id]/_components/CampaignDetail.tsx`, 551 lines),
     which is **read-only** — variant bodies render as gray boxes with *no publish,
     no schedule, no refine*. So multi-persona generation cannot complete the pipeline
     from its own review surface. This is a real pipeline bug, not just UX.

2. **Two competing progress mechanisms.** The chat page polls
   `GET /api/ingest/{job_id}` every 1 second for up to 60 s (`chat/page.tsx` lines
   ~240–264) *and* separately subscribes to Supabase realtime for the generation stage.
   The campaign page uses realtime only. The 1 s poll is the dominant source of the
   "slow/laggy" feel.

3. **Two oversized components** (`VariantCard` 553 lines, `CampaignDetail` 551 lines) each
   mix many concerns (display, copy, publish, schedule, refine, history), which is where
   bugs hide and why they are hard to make consistent.

4. **Scattered, inconsistent visual + error treatments** across the spine screens, so it
   reads as a prototype rather than one intentional product.

---

## 2. Approach

**Approach A — targeted spine hardening (chosen).** Keep the architecture exactly as
`CLAUDE.md` mandates (Next.js thin auth/proxy/UI layer + Python worker owning all
mutations/scraping/LLM). Fix the spine in place along four tracks in dependency order.
No rebuild of working code, no new dependencies, no schema or worker changes.

Rejected: (B) rebuild the spine UI fresh — throws away working code and risks regressing
the one path that works; (C) polish-only — leaves the structural causes of "slow" and
"confusing" in place.

---

## 3. The four tracks (in dependency order)

### Track 1 — Flow unification (first; unblocks the rest, fixes the pipeline bug)

- `/campaigns/[id]` becomes the **single review surface** for every generation, single or
  multi persona.
- Chat's responsibility ends at "generation started." On generation start, **auto-navigate**
  to `/campaigns/[id]`; drafts stream in live via realtime.
- Remove the chat fork: the inline `ai-variants` branch and `CampaignBatchCard` go away.
  Single-persona generation now also produces a campaign and routes to the same place.
- The campaign review surface gains the **full action set** (publish / schedule / refine /
  revision history / media) that today lives only in the inline `VariantCard`. This is
  achieved by reusing the decomposed shared components from Track 3 — and it is the fix for
  the read-only multi-persona bug.

### Track 2 — Reliability

- **One progress mechanism.** Standardize on the Supabase realtime channels that already
  work: `ingestion_jobs` for extraction stages, `campaigns` + `campaign_personas` for
  generation. **Remove the 1 s polling loop entirely.**
- **Visible, recoverable errors.** Every stage (extract / generate / publish / schedule)
  gets a consistent error state with a retry affordance. The `generation_partial` and
  stuck-`generating` (5-minute watchdog already present in `CampaignDetail`) cases become
  first-class, tested UI states rather than inline edge cases.
- Out of scope: automated publish-retry/backoff queue (a separate worker effort, V2.2 in
  `SOCIALOS_V2_PLAN.md`). Here we surface failure clearly and allow manual re-publish.

### Track 3 — Speed (largely falls out of Tracks 1 & 2)

- Removing the 1 s poll removes the dominant perceived-lag source.
- Decompose `VariantCard` into focused units: `VariantBody` (display + copy),
  `VariantActions` (publish + schedule: slot picker + custom time), `RefinePanel`
  (quick chips + free-text rewrite), `RevisionHistory` (list + revert).
- Decompose `CampaignDetail` so the page is a thin **server shell + small client islands**,
  matching the dashboard/queue/profile pattern in `CLAUDE.md` B.7.
- These splits reduce client JS per screen and make each unit individually testable.

### Track 4 — Polish (design-system pass, scoped to the spine only)

- Extract repeated Tailwind into a small set of shared primitives/tokens: status badge,
  platform chip, card shell, button variants, and consistent empty/loading/error states.
- Uses the existing Tailwind v4 + shadcn-vendored setup. **No new dependencies.**
- Scoped to the spine screens (chat entry, campaign review, the shared variant components).
  Does **not** sweep connections / onboarding / settings beyond where a shared primitive
  trivially applies.

---

## 4. Component & data-flow design

### Target structure of the unified review surface

```
campaigns/[id]/page.tsx          server: fetch via lib/db/campaigns, pass to island
  _components/
    CampaignReview.tsx           client island: realtime subscription + refresh +
                                 campaign-level actions (approve-all, cancel-scheduled, delete)
    PersonaGroup.tsx             one persona's header + approval + its variant cards
    VariantCard.tsx              SHARED actionable card (moved out of chat/_components)
      VariantBody.tsx            display + copy
      VariantActions.tsx         publish / schedule (slot picker + custom time)
      RefinePanel.tsx            quick chips + free-text rewrite
      RevisionHistory.tsx        history list + revert
```

After Track 1, chat renders no variants at all, so a draft is acted on in exactly one place.
The read-only multi-persona bug disappears by construction.

### End-to-end data flow

```
Chat (entry only)
  URL  → POST /api/ingest → realtime(ingestion_jobs) → "extracted" card → Generate
  text → POST /api/ingest (text) → Generate
        ↓ POST /api/campaigns   (ALWAYS creates a campaign — single OR multi persona)
        ↓ router.push(/campaigns/[id])         ← the fork dies here

Campaign review (single surface)
  realtime(campaigns + campaign_personas) → live variant fills + status
  per-variant : publish / schedule / refine / revision history   (existing proxy routes)
  per-persona : approve / reject
  campaign    : approve-all / cancel-scheduled / delete
```

**No new API routes, no new worker endpoints, no schema changes.** Every proxy route this
needs already exists. This stays within `CLAUDE.md`: thin proxies, all DB access via
`web/lib/db/*`, no third-party SDKs in web, no service-role key in web.

---

## 5. Error handling

- Each pipeline stage maps to one consistent UI treatment: extraction failure, whole-campaign
  generation failure, per-persona partial failure, publish failure, schedule failure.
- These converge on one shared error component with a retry affordance, replacing today's
  scattered treatments (`ai-error` in chat, `failure_reason` block in campaign, inline
  `error` ActionState in the card).
- The stuck-`generating` 5-minute watchdog stays and becomes a documented, tested state.

---

## 6. Testing (Vitest, no live Supabase — CLAUDE.md B.7)

- `parseInput()` URL/angle extraction (pure function).
- Variant components render correctly per `ActionState` (publish / schedule / refine
  state machine).
- Chat → campaign handoff: generation start triggers navigation (mock fetch + router).
- Realtime mocked: test the refresh/reducer logic, not the socket.

---

## 7. Out of scope (discipline)

- No new pages: no calendar, analytics depth, repurposing engine, competitor monitoring,
  agent mode. These are the earned backlog.
- No worker/backend changes, no schema changes, no new npm/pip deps.
- No publish-retry queue, no MCP connectors, no prompt-versioning UI — all real V2 items,
  each a separate effort.
- No touching connections / onboarding / settings beyond trivial reuse of a shared primitive.

---

## 8. Success criteria

1. Generating single **and** multi-persona both land on `/campaigns/[id]`, and every draft
   there can be published, scheduled, and refined.
2. No 1-second polling anywhere in the spine — realtime only.
3. `VariantCard` and `CampaignDetail` each decomposed into focused units; the campaign page
   is a server shell + client islands.
4. Every failure mode shows a clear, recoverable state.
5. `pnpm typecheck` clean and `pnpm test` green.
