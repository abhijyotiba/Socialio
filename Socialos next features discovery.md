# SocialOS — Next Phase Feature Discovery Doc

> **Status:** Pre-planning draft. This document captures a product strategy conversation and should be used as the base for drafting the final technical plan and design spec.

---

## Context & Problem Statement

The current SocialOS build — URL ingestion → scraping → AI content generation → scheduling — covers ground that existing tools like Buffer, Hootsuite, and Taplio already cover. The scheduling and AI-enhancement layer alone is not a differentiated moat.

The goal of this discovery is to identify what makes SocialOS genuinely different at production scale, and to plan the architecture and features that get us there before we overbuild in the wrong direction.

The key insight from the conversation: **we are not building a scheduler with AI sprinkled on top. We are building an AI content operations platform.**

---

## Core Product Vision

SocialOS should handle the full content operation of a brand, team, or agency — from source material to published post — across multiple accounts, multiple platforms, and multiple brand voices, with minimal human effort. The human's only required action should be a single approval tap.

### The target user scenarios (all three must be served):

**Scenario A — Solo founder / personal brand**
Building a personal brand on LinkedIn and X. Wants to create content consistently without spending time on it. One voice, a few accounts.

**Scenario B — Startup marketing team**
Main brand page + 5–10 team members each amplifying content in their own voice. One source article → N restyled posts distributed simultaneously across all team member accounts.

**Scenario C — Agency / client management**
Managing 10–20 client accounts, each with their own brand voice, posting schedule, and platforms. High willingness to pay. Most direct fit for a multi-persona architecture.

---

## The Core Differentiated Feature: Multi-Persona Workspace

### What it is

A **Persona** is a named identity inside a workspace. It has:
- Its own voice profile (the voice learning we already built maps directly to this)
- Its own connected social accounts (one persona can have multiple accounts on the same platform — e.g. two X accounts, a personal LinkedIn + a company page)
- Its own posting schedule
- Its own brand configuration / tone settings
- Its own post queue

A **Workspace** can contain many personas (e.g. a startup workspace might have: "Company Brand", "CEO", "Head of Engineering", "Marketing Lead", etc.)

A **Campaign** is the distribution unit: one piece of source content that gets processed once, then restyled and distributed across all selected personas simultaneously. Each persona gets a variant tailored to its voice profile.

### Why this is a moat

No major tool handles this workflow end-to-end. Marketing teams do this manually today — they take one article, rewrite it 10 different ways for 10 different team members, and coordinate posting times. It's painful, doesn't scale, and nobody has automated it coherently.

### The user experience

1. User submits a URL or idea (via the web app or the Telegram bot — see below)
2. System creates a Campaign
3. User selects which personas participate
4. System generates one restyled variant per persona simultaneously (using each persona's voice profile as the generation system prompt)
5. User sees a batch preview: all N variants across all M platforms, collapsed into a single approval screen
6. One tap approves the whole batch, or the user can approve persona by persona
7. Everything enters each persona's queue on their individual schedule

**Result:** One piece of source content → N posts across M platforms from K accounts, all handled automatically.

---

## The Frictionless Input Layer: Telegram Bot

### Why this matters

The biggest SaaS churn driver is login friction. If a founder has to open a browser, navigate to the dashboard, paste a URL, wait, configure platforms, and then approve — they stop doing it. If they can just forward a link to a WhatsApp/Telegram conversation they're already in, the behavior sticks.

### How it works

The Telegram bot is a thin layer on top of the existing API endpoints. It translates chat messages into API calls and API responses back into messages.

**Flow:**
1. User sends a URL or idea to the bot
2. Bot calls `/api/ingest`
3. Bot calls `/api/posts` for all active personas
4. Bot replies with a formatted preview of all variants (collapsed summary)
5. User replies "approve" or "approve 1,3,5" for specific personas
6. Bot calls `/api/posts/{id}/schedule` for approved variants

The bot doesn't need to know anything about content — the existing worker handles all of it. This is a thin translation layer.

### Platform choice

**Start with Telegram.** The Telegram Bot API is clean, free, no business account requirements. WhatsApp requires Meta Business API which has approval delays and ongoing costs. Build Telegram first, add WhatsApp once there's traction and revenue to justify the friction.

### Autopilot vs. Approval

Full autonomous posting (no human review) is a liability for serious brands. One bad AI post can do real damage. The right default is **reducing the human decision to a single approval tap**, not eliminating humans entirely. Full autopilot should be an opt-in feature unlocked after trust is established, not the default.

---

## Database Architecture Changes Required

### Current schema

```
workspace → connections → posts
```

### Required schema

```
workspace → personas → connections → posts
```

### Key changes

**New `personas` table:**
```
id, workspace_id, name, voice_profile, posting_schedule_id, brand_config_id, created_at
```

**Changes to existing tables:**
- `brand_configs` → add `persona_id` FK
- `social_connections` → add `persona_id` FK (one persona can have multiple connections to same platform)
- `posting_schedules` → add `persona_id` FK
- `post_variants` → add `persona_id` FK (trace back to persona, not just workspace)

**New `campaigns` table:**
```
id, workspace_id, source_content (ingestion_job_id), status, created_at
```

**New `campaign_personas` join table:**
```
campaign_id, persona_id, approval_status (pending/approved/rejected), variant_id
```

**Migration strategy:** Non-destructive. Add `personas` table, migrate existing data so each workspace gets a default persona (wrapping their current single-account setup). Update all queries to thread through `persona_id`. Nothing gets thrown away.

### Rate limiting changes

Currently rate limits are workspace-scoped. With multiple personas/accounts, rate limits must be **persona-scoped** (account-scoped). LinkedIn and X both have per-account posting limits. A `persona_rate_limits` table tracking per-account state is needed, and `claim_due_variants` RPC should be extended to include persona-level rate limit checks.

### Token isolation

Currently: one `social_connections` row per platform per workspace. In the persona model: one row per platform per persona, each with its own vault-stored access/refresh tokens. OAuth flows need to carry `persona_id` through the state parameter so the callback knows which persona to attach the connection to.

### Audit logging

When managing multiple accounts for a client, every publish attempt, approval decision, and schedule change should be timestamped and persona-attributed. Implement as an `audit_events` table — simple insert on every significant state transition.

### Dead letter queue

Extend the existing `publish_attempts` pattern: variants that fail three times get flagged for human review rather than silently dropped (currently they just get marked `failed`).

---

## What to Build and In What Order

### Phase 1 — Persona schema migration (foundation, blocks everything else)
- Add `personas` table
- Migrate existing workspace data to create a default persona per workspace
- Update all DB queries to thread through `persona_id`
- Update OAuth callbacks to carry `persona_id` through state param
- Estimated: 2–3 days focused work

### Phase 2 — Persona management UI
- Page to create, name, and configure personas
- Assign voice profiles to each persona
- Connect social accounts to specific personas
- Reuse existing onboarding components (BrandStep, ConnectStep, VoiceSamplesPanel)
- Estimated: 2–3 days

### Phase 3 — Campaign model and multi-persona generation
- Update ingest + generate flow to be campaign-aware
- Persona selection UI in the chat/content studio page
- Per-persona variant cards with persona attribution
- Batch approval UI (approve all / approve selectively)
- Worker: loop `workerGenerate` per persona with each persona's voice profile as system prompt (small code change — infrastructure already exists)
- Estimated: 3–4 days

### Phase 4 — Telegram bot
- Set up Telegram Bot API + webhook server
- Implement: URL/text input → ingest → per-persona generation → preview → approval flow
- Build as a thin layer on top of existing API endpoints
- Estimated: 1 week once Phase 1–3 are complete

### Phase 5 — Smart scheduling (data-driven)
- Use `post_metrics` data to suggest optimal posting times per persona per platform
- Start simple: "posts in your timezone's business hours"
- Evolve toward: "your best engagement was Tuesday 10am, here's why"
- Estimated: ongoing / can start after Phase 3

### Deferred (explicitly not building yet)
- **Autonomous trend discovery** (RSS feeds, web scraping for topic ideas, trend APIs) — expensive infrastructure that needs PMF to justify
- **WhatsApp integration** — build after Telegram has traction
- **Full autopilot posting** — opt-in feature after trust is established
- **Research pipeline** (discovering topics automatically) — separate product problem

---

## Competitive Reality Check

**Who exists:**
- Taplio — LinkedIn-only, some persona features for personal brands
- Authory — content archiving + repurposing, single-account
- Buffer/Hootsuite — scheduling, weak AI
- Typefully — X-focused, single user
- Phantombuster — automation, not content generation

**The gap:** Multi-platform + multi-persona + bot interface as a coherent product genuinely doesn't exist. The closest is teams cobbling together Notion + Zapier + Buffer + manual rewrites.

**The pitch:** "Give us your brand once. We handle every account, every voice, every platform — you approve in one tap."

**The danger:** Building too broadly too fast. The persona system alone, done well, is compelling enough V2 to get early customers and validate before adding bot interfaces and research pipelines.

---

## Open Questions (to resolve before final plan)

1. **Pricing model:** Does persona count become the pricing axis? (e.g. 3 personas free, 10 personas Pro, unlimited Enterprise)
2. **Onboarding for teams:** How does a user invite team members and map them to personas? Is a persona always managed by the workspace owner, or can a team member "own" their persona and set their own voice?
3. **Approval workflow for agencies:** Should clients be able to see/approve posts without having a full SocialOS account?
4. **Persona voice refresh cadence:** When a team member's posting style evolves, how do they update their persona's voice profile? Is it self-serve?
5. **WhatsApp timing:** What traction metric triggers prioritizing WhatsApp over other features?
6. **Campaign branching:** Should a campaign be allowed to post different source content to different personas, or is it always one source → many voices?

---

## Technical Notes on the Existing Codebase

- Voice profiling (`VoiceSamplesPanel`, `workerAnalyzeVoice`, `render_system_prompt`) is already built and maps cleanly to per-persona prompts — this is the biggest piece of pre-built infrastructure for the persona system
- The worker's `workerGenerate` just needs to loop per persona with that persona's voice profile as the system prompt — small change
- `publish_attempts` + idempotency is already solid — extend with persona attribution and dead-letter logic
- The existing `posting_schedules` table just needs a `persona_id` FK added
- Telegram bot implementation: `python-telegram-bot` or direct webhook; webhook is simpler for the Fly.io deployment setup already in place for the worker

---

*This document was drafted from a product strategy conversation. It is not a final spec. Use it as input to draft the final design and technical plan.*