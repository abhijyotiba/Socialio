# SocialOS — Version 2 Strategic Plan

**Prepared:** April 2026
**Scope:** V2 roadmap, V3 backlog, trade-off decisions
**Basis:** PRD v1.1, current codebase (end of Phase 5, Phase 6 Polish in progress), `docs/VERSION_2_PLANNING.md`, `docs/BACKLOG.md`, session notes gotchas, and PRD v1.1 commitments not yet delivered.

---

## 1. Current State Assessment

### 1.1 What has shipped (Phases 0–5, most of 6)

| Area | Status | Notes |
|---|---|---|
| Auth (email + Google) | ✅ Shipped | Supabase Auth, middleware, onboarding gate |
| Workspaces + RLS | ✅ Shipped | `workspace_members` in place; team-ready schema |
| Brand config | ✅ Shipped | CRUD + versioned `prompt_versions` writes |
| LinkedIn OAuth | ✅ Shipped | OIDC + `w_member_social` scope requested |
| X/Twitter OAuth (PKCE) | ✅ Shipped | `offline.access` for long-lived tokens |
| Token storage | ✅ Shipped | Supabase Vault (not custom AES) |
| Ingestion pipeline | ✅ Shipped | Playwright + SSRF guard + Cloudinary |
| LinkedIn URL block | ✅ Shipped | ToS-safe by design |
| Generation pipeline | ✅ Shipped | Groq primary → Gemini fallback, two-pass |
| Publish (LinkedIn + X) | ✅ Shipped | Idempotency keys, `publish_attempts` log |
| Scheduling | ✅ Shipped | `posting_schedules`, `claim_due_variants()` RPC, `FOR UPDATE SKIP LOCKED` |
| Cron publisher | ✅ Shipped | Sweeper for stuck rows, parallel publish |
| Token refresh cron | ✅ Shipped | Silent refresh, `needs_reauth` flag on failure |
| Media attachments | ✅ Shipped | 4-asset cap, user upload + scraped reuse |
| Metrics table + pull cron | ✅ Shipped | Dashboard showing impressions/likes/comments |

### 1.2 Partially complete

| Area | Gap |
|---|---|
| Prompt versioning | Writes new versions on edit; **no diff UI, no rollback, no per-post "which version" label, no performance correlation** |
| Analytics | Dashboard shows raw counts; **no on-time SLI, no pipeline-stage timing dashboard, no best-time heatmap** |
| LinkedIn publishing | Code works; **`w_member_social` still pending LinkedIn partner approval** → cannot publish in production until approved |
| Rate limiting | **DB-based, has known race condition** (acknowledged in `docs/VERSION_2_PLANNING.md`) |
| Error UX | Failures surface in variant card; **no email / in-app notification when a scheduled post fails overnight** |
| Type safety | Manual types added for `posting_schedules`; pending `gen:types` sync |

### 1.3 Not yet started (committed in PRD v1.1)

- MCP connectors (Google Drive + Notion) — promoted to V1 in PRD v1.1 but not built
- Forbidden phrase filter (DB column `forbidden_phrases` exists, no enforcement)
- Hashtag library (column exists, unused)
- Prompt templates ("Product Launch", "Thought Leadership")
- Platform-specific prompt overrides
- URL-hash ingestion cache
- Publish retry with exponential backoff (sweeper exists, but doesn't re-attempt)
- `google-generativeai` → `google-genai` migration (deprecated, tracked in BACKLOG)
- Admin-client import CI lint rule (documented policy, not enforced)

### 1.4 Product maturity

**Assessment: late-beta.** The full happy path (signup → brand → connect → ingest URL → generate → schedule → publish → pull metrics) works end-to-end. Multi-tenant is real (RLS enforced), tokens are vaulted, publishing is idempotent, the cron handles concurrency correctly.

**But three things block "production-ready":**

1. **LinkedIn partner approval** — a process risk, not an engineering one.
2. **Silent failure handling** — a scheduled post that fails at 3 AM surfaces only in the DB, not to the user.
3. **The product wedge is half-built** — PRD v1.1 calls out chat-first + versioned prompts + MCP as the differentiator. MCP is missing entirely, and the versioning UI that would make the wedge visible doesn't exist.

This is a solid V1 chassis with a V1-and-a-half surface. V2 is about closing the wedge and hardening for real customers, not building new verticals.

---

## 2. Feedback Analysis

Developer signals come from the codebase (`BACKLOG.md`, `VERSION_2_PLANNING.md`, session-note gotchas, deprecated dependencies, race conditions flagged in comments). User/client signals are inferred from PRD v1.1 commitments not yet delivered and from the gap between the stated wedge and what is actually shippable today.

### 2.1 Developer feedback

| # | Item | Source | Impact |
|---|---|---|---|
| D1 | `google-generativeai` is EOL; migrate to `google-genai` | `BACKLOG.md` | **High** — blocks security/patch updates on a core dependency |
| D2 | Rate limiting has DB race condition; move to Upstash Redis | `VERSION_2_PLANNING.md` | **High** — bypassable under concurrent load |
| D3 | No URL-hash cache; identical URLs re-scraped | `VERSION_2_PLANNING.md` | Medium — wastes Playwright compute and Cloudinary storage |
| D4 | No retry queue; `failed` posts stay `failed` | `VERSION_2_PLANNING.md` | **High** — transient 5xx's kill user trust |
| D5 | Admin-client import rule documented, not CI-enforced | `ARCHITECTURE.md` §9 | Medium — one careless import becomes a security incident |
| D6 | LinkedIn `w_member_social` approval not in | Session notes (Phase 4) | **High, external** — blocks real publishing |
| D7 | X free tier: 17 tweets/user/day | Session notes (Phase 4) | Medium — need to surface this in UI before it's a support ticket |
| D8 | `gen:types` needs to run; manual type edits pending | Session notes | Low — housekeeping |
| D9 | No stage-timing dashboard / on-time SLI | PRD §12.4 committed | Medium |
| D10 | `createAdminClient` exception in publish routes is undocumented in lint | `DECISIONS.md` 2026-04-23 | Low |

### 2.2 Client / user feedback (inferred from PRD v1.1 gaps vs stated wedge)

| # | Item | Impact |
|---|---|---|
| C1 | Can't point at Notion/Drive docs despite being the stated wedge | **High** — the "use the doc titled Q2 strategy" demo doesn't work |
| C2 | No visibility into prompt history / diff / rollback | **High** — versioning is a wedge that the user can't see or use |
| C3 | Silent failures — scheduled post fails, no notification | **High** — #1 cause of tool abandonment for schedulers |
| C4 | Forbidden phrase filter not enforced | Medium — advertised, not delivered |
| C5 | Hashtag library unused; no auto-append | Medium |
| C6 | No posting templates (Product Launch, Thought Leadership) | Medium |
| C7 | No calendar view of scheduled posts | Medium — current list works, but calendar is expected table stakes |
| C8 | No best-time heatmap / prompt-performance correlation | Medium — "nice-to-have" until analytics volume justifies it |
| C9 | No LinkedIn Company Page | Medium — Persona 2 blocker, not Persona 1 |
| C10 | No team workspaces / approval workflow | Low (current scale) — Persona 3 (agency) is a V3 persona |
| C11 | No bulk CSV upload | Low |
| C12 | No browser extension | Low |
| C13 | No AI image generation | Low — expensive, tangential to core value |

### 2.3 Conflicts between dev and client priorities

| Conflict | Dev view | Client view | Who should win |
|---|---|---|---|
| **Tool registry vs arbitrary MCP** | Devs: managed registry only (SSRF, cost control — `VERSION_2_PLANNING.md`) | Clients: "just let me connect my tools" | **Devs.** Ship Drive + Notion as managed connectors. Arbitrary-MCP is V3+. |
| **Retry queue complexity** | Devs: non-trivial to get right with idempotency | Clients: "just retry it, obviously" | **Clients.** Silent failure is the #1 trust-killer for a scheduler. Must ship in V2. |
| **Prompt-performance analytics** | Devs: needs a month of engagement data to matter | Clients: would love "v4 beat v3 by 23%" | **Devs.** Defer to V3 — correlation is meaningless without volume. |
| **Team workspaces** | Devs: schema ready, UI is 3–4 weeks | Clients (Persona 3): must-have | **Devs.** Defer; current scale is single-user. Re-evaluate after first 5 paying agency leads. |
| **Calendar UI** | Devs: new view component, not trivial | Clients: expected | **Mixed.** Do a read-only month view in V2, full drag-and-drop in V3. |

---

## 3. Version 2 Roadmap — Prioritized

**Theme: "Finish the V1 wedge; harden the rails."**

V2 is not about new verticals. It's about making the product we said we were building in PRD v1.1 actually usable by the two V1 personas (solo founder, content manager), and removing the quiet-failure modes that destroy scheduler trust.

### Tier 1 — Ship first (blockers)

#### V2.1 — LinkedIn partner approval + production readiness *(external, in parallel)*
- Submit `w_member_social` review now if not already done.
- Engineering cost: low (forms, screenshots, sample posts).
- Justification: we cannot actually publish to LinkedIn for real users until this clears. Every other V2 item is downstream of this.

#### V2.2 — Publish retry with exponential backoff (D4, C3)
- Extend cron sweeper: a `failed` post with `retry_count < 3` and `next_retry_at <= now()` gets re-queued.
- Backoff: 5m → 15m → 60m. After 3rd failure, mark `failed_terminal`, email + in-app notify.
- Justification: scheduled-post tools live and die on this. Client C3 is the single highest-value fix. Dev D4 is the same item.
- Effort: ~1 week (one migration for `retry_count`, `next_retry_at`, `failed_terminal` enum; cron logic; notification hook).

#### V2.3 — Failure notifications (C3)
- In-app banner + email on terminal publish failure.
- "X needs reauth" banner already exists; extend the pattern.
- Effort: ~3 days. Ships with V2.2.

#### V2.4 — Gemini SDK migration (D1)
- Replace `google-generativeai` with `google-genai`.
- Mechanical migration; tracked in BACKLOG already.
- Effort: half a day. Ship immediately to clear the EOL warning.

### Tier 2 — Close the wedge

#### V2.5 — MCP connectors: Google Drive + Notion (C1)
- Managed connectors only. **No arbitrary-MCP.** Reasoning in §5.
- Per-user OAuth; `mcp_connections` table per PRD §8.1.
- Chat intent classifier: "use the doc titled X" → tool call → doc text → generation pipeline.
- Justification: the stated wedge. Without this, SocialOS is a LinkedIn + X scheduler with a nicer UI than Buffer — a crowded, commoditized category.
- Effort: ~2 weeks (two adapters + OAuth + classifier + settings UI).

#### V2.6 — Prompt versioning UI (C2)
- Settings → Brand → Prompt History: timestamped list, side-by-side diff, one-click rollback, per-version notes field.
- Per-post pill showing "generated with v4" linking to the version.
- Justification: versioning is a wedge only if visible. Ships the second half of the differentiator.
- Effort: ~1 week (diff library, list view, rollback mutation; schema is already there).

#### V2.7 — Forbidden phrase filter + hashtag library (C4, C5)
- Post-generation scan against `brand_configs.forbidden_phrases`; highlight matches in yellow; advisory, not blocking.
- `hashtag_library` auto-appended on a per-platform basis.
- Justification: both are DB columns that already exist and were promised in PRD v1.1. Low effort, high "feels finished" payoff.
- Effort: ~3 days combined.

### Tier 3 — Harden the rails

#### V2.8 — Upstash Redis rate limiting (D2)
- Replace DB counter with `@upstash/ratelimit` sliding window.
- Justification: PRD §11.3 always called for this. Race condition is acknowledged. Protects DB under spike load.
- Effort: ~2 days (Upstash wiring + `/api/ingest` middleware).

#### V2.9 — URL-hash ingestion cache (D3)
- Hash URL; if identical URL scraped in last 7 days, return cached extraction + media.
- Justification: cuts Playwright compute (expensive) and Cloudinary re-uploads. Pays for itself at ~50 DAU.
- Effort: ~3 days (new `ingestion_cache` table, lookup in `/api/ingest`).

#### V2.10 — Admin-client CI lint rule (D5)
- ESLint custom rule: `createAdminClient` may only be imported in `app/api/cron/**`, `app/api/oauth/**/callback/**`, `app/api/posts/[id]/publish/**`.
- Justification: security policy documented in ARCHITECTURE §9 and DECISIONS 2026-04-23. Currently honor-system. One careless import = service-role key in a user-facing route.
- Effort: 1 day.

### Tier 4 — Analytics & visibility (partial, pragmatic)

#### V2.11 — On-time SLI + stage-timing dashboard (D9)
- Internal-only dashboard: on-time publish %, pipeline-stage P50/P95 per day.
- Justification: PRD §12.4 committed metric. Operational, not user-facing.
- Effort: ~3 days.

#### V2.12 — Read-only calendar view (C7 partial)
- Month-view grid showing scheduled posts. Click → variant card. No drag-and-drop yet.
- Justification: table stakes for a scheduler. Full editing UX deferred to V3.
- Effort: ~4 days.

### V2 totals

- **Scope:** 12 items, ~6–7 engineering weeks solo, 3–4 weeks with a second engineer.
- **Risk budget:** LinkedIn approval is the only external dependency.
- **Shipping order recommendation:** V2.4 (half day) → V2.8 + V2.10 (hardening, 3 days) → V2.2 + V2.3 (retry + notify, 1.5 weeks) → V2.6 + V2.7 (versioning UI + filters, 1.5 weeks) → V2.9 (cache, 3 days) → V2.5 (MCP, 2 weeks) → V2.11 + V2.12 (1 week).

The MCP work is last because it's the largest and most uncertain. If scope pressure hits, cut V2.12 and V2.11 first, then delay V2.9 — never cut retries (V2.2) or MCP (V2.5).

---

## 4. Version 3+ Backlog — Deferred

| # | Item | Why deferred |
|---|---|---|
| V3.1 | Team workspaces + approval workflows | Schema is already team-ready; UI is 3–4 weeks. Current scale (solo founders, single-workspace users) does not justify it. Re-evaluate after 5+ paying agency leads (Persona 3). |
| V3.2 | LinkedIn Company Page posting | Requires LinkedIn Partner Program approval on top of `w_member_social`. Personal-profile posting is sufficient for Personas 1 and 2. Revisit when Persona 2 asks explicitly. |
| V3.3 | Content calendar — drag-and-drop editing | V2 ships read-only month view. Full editing needs conflict handling, optimistic updates, and reschedule-cascades. Not worth the complexity until users have >20 scheduled posts at a time. |
| V3.4 | Bulk CSV upload | Power-user feature. Useful for agencies (Persona 3), less so for Personas 1/2. |
| V3.5 | Browser extension (one-click capture) | Ships distribution value but requires Chrome store review + a separate codebase. Wait until core product has PMF signal. |
| V3.6 | AI image generation (DALL-E / Flux) | Expensive per-generation cost (~$0.04 each), tangential to the "brand-consistent text" core value, and competes with users' existing image tools. Only justify if analytics show text-only posts underperform significantly. |
| V3.7 | Prompt-version performance correlation | Needs >60 days of engagement data across multiple prompt versions per workspace to be statistically meaningful. Today's user would see noise, not signal. Build the data pipeline in V2 (metrics already flow); expose the correlation UI in V3. |
| V3.8 | Best-time-to-post heatmap | Same reason as V3.7 — per-workspace engagement data sparse at current scale. |
| V3.9 | Arbitrary / user-provided MCP servers | **Explicitly decided against for V3 too**, per `VERSION_2_PLANNING.md` §1.2. Security (SSRF), cost (runaway agentic loops), and reliability (can't test user-provided servers) rule it out. Only revisit if an enterprise customer is paying enough to justify a sandbox. |
| V3.10 | Managed tool registry (web search, internal KB vector) | Excellent long-term direction from `VERSION_2_PLANNING.md`. Premature in V3 until we know which tools users actually ask for. Let V2 MCP usage data inform the V3 tool list. |
| V3.11 | Instagram / Threads / Bluesky / Facebook | Platform adapter pattern is built precisely for this. Ship when a real customer asks — each platform is 4–6 hours of adapter + OAuth work, justified only by demand. |
| V3.12 | Video publishing (LinkedIn 200MB, X 512MB) | Streaming upload + pre-publish size guard is specified in PRD §7.7.4 but not built. Image-only covers 90% of published posts today. |
| V3.13 | Zapier / Make.com webhook triggers | Distribution play; hold until core product has pull. |
| V3.14 | GDPR data export self-serve | Currently on-request (manual). Automate when EU traffic is non-trivial. |

---

## 5. Trade-off Decisions — Why

### 5.1 Managed MCP over arbitrary MCP
**Decision:** ship Google Drive + Notion connectors we built and vetted. Refuse arbitrary user-provided MCP servers in V2 and V3.
**Why:** an arbitrary MCP server URL is an SSRF vector, a latency bomb, and a cost bomb (agentic loops can burn tokens without bound). The security model of a multi-tenant SaaS cannot absorb "and also this endpoint the user picked." Managed registry is the right long-term shape per `VERSION_2_PLANNING.md`, and V2's two connectors are the opinionated first step.
**Who loses:** power users who wanted to plug in their own internal wiki. That's a V3+ decision gated on paying enterprise demand.

### 5.2 Retry queue over more analytics
**Decision:** build publish retry + failure notifications (V2.2, V2.3) before any new analytics views.
**Why:** a scheduler that silently drops posts loses trust in one incident. A scheduler with thin analytics loses trust over months. The prior is existential, the latter is a feature gap.

### 5.3 Prompt versioning UI in V2, prompt-performance correlation in V3
**Decision:** ship the visible half of the wedge now (diff, rollback, per-post version pill). Defer the analytical half until enough engagement data exists to say something meaningful.
**Why:** versioning as a *UX* is the differentiator. Versioning as *statistics* needs 60+ days of data per workspace and won't be real until 2027. Shipping a correlation view now would show noise, not signal, and actively erode trust in the feature.

### 5.4 Read-only calendar in V2, drag-and-drop in V3
**Decision:** give users a month view now with no editing; add reschedule-by-drag in V3.
**Why:** "can I see my next month at a glance" is a legitimate V2 request. "Can I drag Thursday's post to Friday" requires conflict handling, cascade logic (what if that slot is taken?), and optimistic UI — all of which are real engineering weeks with low incremental value over the click-to-edit flow we already have.

### 5.5 Hard "no" to AI image generation in V2 and V3
**Decision:** skip generative images until there's volume evidence text-only posts underperform.
**Why:** generation cost is $0.02–$0.08 per image, and most users have Midjourney/Canva habits they don't want disrupted. We win on *text* quality, not image generation. Revisit only if user research shows image-less posts systematically underperform.

### 5.6 Keep the "Python island" architecture
**Decision:** do not split more services out of `worker/`. Do not move CRUD or publishing to FastAPI.
**Why:** the current shape works. Python owns scraping + LLM; Next.js owns everything else. Every service we add is a deploy target, a CORS wall, and a duplicate auth layer. Resist until a specific pain point justifies it.

### 5.7 Defer team workspaces despite schema readiness
**Decision:** the schema has `workspace_members`, RLS is member-based, and V2 of this plan would not write any user-scoped FKs. But we don't build the team UI in V2.
**Why:** we have zero validated demand signal. Persona 3 (agency) is explicitly a V1-out-of-scope persona in PRD §4. Building team UX speculatively is weeks of work producing a feature nobody has asked for yet.

---

## 6. Risks & Blind Spots

### 6.1 LinkedIn partner approval is on the critical path
If `w_member_social` review takes 4–6 weeks (normal) or rejects us (possible), every V2 item that depends on "users actually publish to LinkedIn" is theater. **Mitigation:** submit immediately if not already done; build a mock-publish mode for demos and sales conversations; keep X/Twitter publishing fully working as the fallback demo path.

### 6.2 X free tier is a ceiling, not a floor
17 tweets/user/day means a customer scheduling daily + running an internal test posts up to their cap fast. At scale this forces us onto X's $100/mo basic tier, which has its own per-app limits. **Mitigation:** in V2, add a pre-publish guard showing "3 of 17 tweets used today"; plan pricing so X basic tier is priced in by the time we have 50+ DAU.

### 6.3 MCP connectors expose a new attack surface
Both Google Drive and Notion OAuth give read access to user documents. We're pulling text into LLM prompts — prompt-injection via a malicious doc is a real threat. **Mitigation:** wrap all fetched MCP content in XML delimiters before LLM injection (PRD §11.3 already says this; must be enforced in MCP path specifically). Log content lengths but never content itself.

### 6.4 Metrics pull-back depends on APIs we don't control
LinkedIn's `organizationalEntityShareStatistics` endpoint is versioned (`LinkedIn-Version` header) and has been deprecated/renamed twice in two years. X's `public_metrics` field is tied to plan tier. **Mitigation:** treat the metrics cron as best-effort; never block a feature on metrics availability; log API version drift to Sentry so we see the break before users do.

### 6.5 Single developer / small team bandwidth
V2 is 6–7 weeks of focused work. At realistic 60% utilization with bug-fix interrupts, that's 10–12 calendar weeks. **Mitigation:** ship Tier 1 + Tier 2 first (retries, notifications, MCP, prompt UI). Tier 3 and 4 are pure upside. Do not add scope mid-V2.

### 6.6 Blind spot — we don't actually have user feedback
This whole plan is built on PRD v1.1 intent, the repo's internal `VERSION_2_PLANNING.md` (developer perspective), and inferred client priorities. We do not have transcripts from real users. **The single most important thing to do in parallel with V2 engineering is get 5 beta users using SocialOS and collect real feedback.** Every "client need" in this document is educated guessing until then. If one real user says "I don't care about MCP, I need a mobile app," rerank aggressively.

### 6.7 Vercel Hobby timeout (10s) vs generation time
Generation currently fits in 10s with Groq. If Groq slows down or users pick larger models, the sync route breaks. **Mitigation:** already noted in DECISIONS 2026-04-23; add a dashboard alert when P95 generation time crosses 8s; plan to upgrade to Vercel Pro or async-ify before the first incident.

### 6.8 LLM hallucinations in generated posts
The Pass 2 generator can fabricate statistics that weren't in the source. There's no fact-check layer. **Mitigation:** V2.7's forbidden-phrase filter is not a fact-checker. Add a "source quote check" in V3 that highlights claims in the generated post not present in the source text.

---

## Cron cadence

There is **no in-repo scheduler** — the worker's `/cron/*` endpoints are driven
by an external pinger (e.g. a platform cron / uptime monitor). The
retry/backoff schedule for failed publishes uses fixed 5 / 15 / 60-minute
buckets (`post_variants.next_retry_at`), and each bucket only fires when
`/cron/publish-due` runs and re-claims the due `failed` rows. **The external
pinger must call `/cron/publish-due` at least every 5 minutes** so the first
(5-minute) retry bucket fires on time; a slower cadence delays every retry by
the gap between pings.

---

## 7. TL;DR

**V2 ships (in order):**
1. Gemini SDK migration (half day)
2. Redis rate limiting + admin-client lint rule (hardening, 3 days)
3. Publish retry + failure notifications (1.5 weeks) ← **most important**
4. Prompt versioning UI + forbidden-phrase filter + hashtag library (1.5 weeks)
5. URL-hash cache (3 days)
6. Google Drive + Notion MCP connectors (2 weeks) ← **closes the wedge**
7. On-time SLI dashboard + read-only calendar (1 week)

**V2 does not ship:** team workspaces, Company Pages, drag-and-drop calendar, bulk CSV, browser extension, AI image gen, prompt-performance correlation, arbitrary MCP, video publishing.

**Strategic bet:** the differentiator isn't scheduling — every tool schedules. It's *chat + MCP + versioned prompts*. V2 finishes the differentiator. V3 scales it.

**Biggest risk:** we're planning without real user voices. Get 5 beta users in the product this month and re-rank this list against their actual pain.




















































# SocialOS V2 Strategic Planning

I'll analyze the current state, feedback sources, and produce a focused V2 roadmap. Let me work through this systematically before creating the deliverable.You specified markdown output, so no skill needed. Let me think through this properly before writing.

**Thinking through the analysis:**

**Current state (from repo):**
- Phases 0–5 shipped: auth, brand config, LinkedIn+X OAuth, ingestion (Playwright+Cloudinary), generation (Groq→Gemini), publishing with idempotency, scheduling/cron, media attachments
- Phase 6 (Polish) is in progress — media attachments just shipped, metrics table + pull-metrics cron exists
- Dashboard shows metrics; queue shows scheduled posts
- **Missing vs PRD v1.1:** MCP connectors (Google Drive/Notion), prompt versioning UI (schema exists but no diff/rollback UI), forbidden phrase filter, hashtag library, posting template system, prompt performance correlation, image-size auto-transforms for platform specs, video streaming guards, sweeper reset currently runs but there's no in-app notification on failure, rate limiting is DB-based (race condition noted in V2 planning doc)

**Feedback signals I'm inferring** (the user hasn't pasted explicit feedback lists, so I'll work from what's actually in the codebase — the `docs/VERSION_2_PLANNING.md` file, `docs/BACKLOG.md`, session notes gotchas, and implicit PRD gaps):

*Developer signals:*
- `google-generativeai` is deprecated → needs migration to `google-genai` (in BACKLOG)
- Rate limiting has race condition (DB-based, should be Redis)
- No URL-hash caching for ingestion (re-scrapes same URL)
- No retry queue for failed publishes
- LinkedIn `w_member_social` requires partner approval (blocking real publishes)
- X free tier: 17 tweets/day/user — hard ceiling
- No sweeper notification when publishes fail
- Admin client whitelist is documented but not CI-enforced
- Types file has manual edits pending `gen:types` sync

*Client/user signals (inferred from PRD goals not yet shipped):*
- Can't actually use LinkedIn posts as source (no MCP, no paste helper)
- No visibility into which prompt version wrote a post or performance
- No posting templates ("Product Launch", "Thought Leadership")
- No team/agency workspace (Persona 3 blocked)
- No approval workflow
- No bulk scheduling / calendar view
- No content calendar UI
- Analytics dashboard is thin — no "best time" heatmap, no prompt-version correlation

**Prioritization logic:**
- Must-fix (stability): Gemini SDK migration, Redis rate limiting, publish retry, LinkedIn partner approval, sweeper notifications
- High user value (V1 PRD gaps): MCP Google Drive/Notion, prompt versioning UI, forbidden phrases, URL-hash cache
- Lower priority for scale reasons: team workspaces, calendar, agency mode, browser extension, AI image gen — defer to V3

**Tradeoffs:**
- Devs want tool registry (managed MCP); clients want "my Notion/Drive" — these align if we ship managed MCP for Drive+Notion (PRD v1.1 already committed to this)
- Devs want to defer retry queue; clients experience silent failures — must do retry+notifications in V2
- Clients want team workspace; devs say schema already supports it but UI is weeks of work — defer to V3, single-user is fine for current scale

Now writing the deliverable.The plan is in a single markdown file. A few notes on how I worked through it:

**On the inputs:** You referenced "developer feedback" and "client feedback" but the repo is what I had — so I sourced dev signals from `docs/VERSION_2_PLANNING.md`, `docs/BACKLOG.md`, and session-note gotchas, and inferred client signals from PRD v1.1 commitments that haven't shipped. I called this out explicitly in §6.6 as the biggest blind spot: **this whole plan is educated inference until you get 5 beta users and real transcripts in front of it.**

**The core strategic bet:** V2 is "finish the V1 wedge, harden the rails" — not new verticals. The differentiator per PRD v1.1 is chat + MCP + versioned prompts, and two of those three are half-built or missing. V2 ships them. The top three must-do's are (1) publish retry + notifications because silent failures kill schedulers, (2) Google Drive + Notion MCP because that's the wedge, and (3) the prompt-versioning UI because versioning is only a differentiator if users can see it.

**What I deliberately refused to put in V2:** team workspaces (no validated demand), AI image gen (expensive and off-strategy), arbitrary user-provided MCP servers (SSRF + cost risk), prompt-performance correlation (no data volume yet), drag-and-drop calendar (real weeks of work, low marginal value over click-to-edit). Reasoning for each is in §5.

Let me know if you want me to tighten any section, or if you actually have real user/dev feedback to paste in and re-rank against.