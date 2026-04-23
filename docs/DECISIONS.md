# Decisions Log

Append-only. Newest at the top. Every non-obvious architectural or product decision lives here, so we don't re-litigate it every session.

Format:

```
## YYYY-MM-DD: Short title
**Decision:** the thing we decided.
**Why:** the reasoning in plain language.
**Alternatives considered:** what we rejected.
**Trade-off:** what this costs us.
**Reversibility:** cheap / medium / expensive to undo later.
```

---

## 2026-04-23: Prompt provenance stored on both content_items and post_variants

**Decision:** `post_variants` now stores `prompt_version_id` in addition to `content_items.prompt_version_id`. Generation writes both so each variant carries explicit prompt provenance.

**Why:** Audit and publish diagnostics are variant-centric (`post_variants.id` is the idempotency anchor for publishing). Storing provenance only at the content-item level weakens traceability for per-platform behavior and future retries/analytics.

**Alternatives considered:** Keep provenance only on `content_items` and resolve via join when needed. Rejected because it adds avoidable coupling and makes downstream auditing/reporting queries harder.

**Trade-off:** One extra nullable FK column and index on `post_variants`.

**Reversibility:** Medium. Easy to stop writing it, but removing the column later requires migration and backfill considerations.

## 2026-04-23: Groq primary / Gemini fallback LLM strategy

**Decision:** The worker's `adapters/llm.py` tries Groq first and falls back to Gemini on any exception. Model config (`groq_model`, `gemini_model`) lives in `Settings` so it can be overridden via env vars without code changes.

**Why:** Groq is faster and cheaper for Llama 3; Gemini is a reliable fallback with a generous free tier. Having both prevents a single point of failure for generation.

**Alternatives considered:** OpenAI (more expensive, no speed advantage for our use case), single provider (fragile if that provider has an outage).

**Trade-off:** Two API keys to manage, two different SDK interfaces in the codebase.

**Reversibility:** Cheap — swap the adapter function and re-deploy.

---

## 2026-04-23: POST /api/posts is synchronous in Phase 3

**Decision:** The generation route waits for the worker to return before responding (same pattern as Phase 2 ingest). Supabase Realtime is used for stage-label updates in the UI, but the response body carries the final variants.

**Why:** Async fire-and-forget on Vercel Hobby has a 10s function timeout. Adding `@vercel/functions waitUntil` or a background queue introduces infra complexity not yet warranted. Generation currently takes < 10s with Groq.

**Alternatives considered:** Vercel `waitUntil` (works on Pro, not Hobby), Inngest background jobs (adds a managed service), polling-only (simpler but less responsive UI).

**Trade-off:** If generation ever exceeds the Vercel timeout (10s Hobby / 60s Pro), we will need to move to async. Noted for Phase 5.

**Reversibility:** Medium. Moving to async requires a job queue and changing the client polling model.

---

## 2026-04-22: Single Next.js app + thin Python worker (not a split FastAPI backend)

**Decision:** The web app is Next.js 15 with Route Handlers for all CRUD, auth, OAuth callbacks, and cron. A single Python FastAPI service called `worker/` exists only for Playwright scraping and LLM orchestration.

**Why:** Two services with shared Supabase schema and duplicated auth/Zod code is more overhead than one Next.js app with a stateless compute side-service. The only things Node is genuinely bad at here are Playwright (Python has better stealth ecosystem) and LLM orchestration code (Python SDKs are more mature).

**Alternatives considered:** (a) Full FastAPI backend with Next.js as pure frontend — rejected, too much duplication. (b) Full Node including Playwright — rejected, we want the worker isolated on Fly.io with its own memory limits. (c) tRPC — rejected, we want REST so webhooks and MCP integrations plug in naturally.

**Trade-off:** We lose FastAPI's auto-generated OpenAPI docs for CRUD endpoints. Easy to live without.

**Reversibility:** Medium. Splitting out a FastAPI service later is a straightforward refactor if needed.

---

## 2026-04-22: No LangGraph in V1

**Decision:** The ingestion/generation pipeline is written as six plain async Python functions. No LangGraph, no LangChain chains, no orchestration framework.

**Why:** The pipeline is a straight line (scrape → extract → upload → analyze → generate → store). Frameworks are for branching/looping/multi-agent, none of which we have. LangGraph adds debugging overhead, dependency risk, and API-churn maintenance for zero benefit on a linear flow.

**Alternatives considered:** LangGraph (original plan in PRD), LangChain chains, Temporal, Inngest. All add complexity we don't need.

**Trade-off:** If we later need true branching (editorial feedback loops, multi-agent review) we'll need to add orchestration. Plain functions won't scale to that.

**Reversibility:** Cheap. Functions can be lifted into a graph node when we have a reason.

---

## 2026-04-22: Workspaces-and-members from Phase 0, even though V1 is single-user

**Decision:** Every workspace-scoped table foreign-keys `workspace_id`, not `user_id`. A `workspace_members` join table exists from Phase 0.

**Why:** When team accounts ship (roadmap V2), no schema migration is required — just add rows. Migrating `user_id` columns to `workspace_id` later would touch every table.

**Alternatives considered:** Start with `user_id` and migrate later. Rejected because it's a guaranteed painful migration, and the cost of adding the join table now is one trigger function and three tables' worth of RLS.

**Trade-off:** Slightly more ceremony in Phase 0 and a very small perf cost on RLS policies (one join).

**Reversibility:** Expensive to undo. But we don't want to.

---

## 2026-04-22: No multi-tenant LinkedIn scraping, ever

**Decision:** Users cannot paste a LinkedIn URL and have SocialOS scrape it. To use a LinkedIn post as a source, the user copies the text themselves. Other sites (TechCrunch, YouTube, blogs, X public tweets) can be scraped via Playwright.

**Why:** LinkedIn's ToS explicitly prohibits scraping. LinkedIn has sued scrapers in 2025 (Proxycurl case) and removed official Company Pages of companies that scrape (Apollo.io, Seamless.ai in March 2025). A multi-tenant scraper is a high-concentration target: our OAuth app could be banned, breaking every paying customer at once.

**Alternatives considered:** Scrape via third-party (Bright Data, ScrapFly) — deferred; acceptable if needed for a specific use case but not a V1 feature. Build our own stealth stack — rejected, LinkedIn's detection is too aggressive for a small team to keep up with.

**Trade-off:** Slightly worse UX for competitor-LinkedIn-analysis use case. Acceptable — users can still paste the text.

**Reversibility:** N/A; this is a legal/risk decision, not an engineering one.

---

## 2026-04-22: Brand system prompts are versioned

**Decision:** A `prompt_versions` table stores every version of a workspace's brand system prompt. `brand_configs` points at the current version. Every generated post records the `prompt_version_id` it was generated with. Editing the prompt never overwrites; it inserts a new version and updates the pointer.

**Why:** The system prompt is the most important input to output quality. When a user edits it and quality drops, they need to see what changed and roll back. No competitor exposes this; it's also a product wedge.

**Alternatives considered:** Plain `TEXT` column on `brand_configs` with a history table populated by a trigger — rejected, we want the versions to be first-class so the UI can treat them as diff-able objects.

**Trade-off:** Slightly more complex schema and a join on every generate call.

**Reversibility:** Expensive if we have real data. Cheap while the table is empty.

---

## 2026-04-22: Posts are split into `content_items` + `post_variants`

**Decision:** The "logical post" is a `content_items` row. Each platform-specific version is a `post_variants` row. A single piece of content generated from one URL, targeted at both LinkedIn and X, is one `content_items` row and two `post_variants` rows.

**Why:** Users genuinely want different text per platform (LinkedIn verbose, X terse). Collapsing into a single `posts` row forces fan-out edits and makes per-platform scheduling messy.

**Alternatives considered:** Single `posts` table with `platforms JSONB`. Rejected — we lose per-row status machines, per-row retry counts, and per-row scheduling.

**Trade-off:** Slightly more joins when listing "all my content."

**Reversibility:** Expensive once we have data.

---

## 2026-04-22: Token encryption uses Supabase Vault, not custom AES

**Decision:** OAuth tokens are encrypted with Supabase Vault before being stored in `social_connections`. Not with a self-rolled AES-256 implementation, not with `pgcrypto` directly.

**Why:** Vault is managed, audited, key-rotatable, and correct. Rolling our own AES for something this security-critical is where leaks happen.

**Alternatives considered:** `pgcrypto` with a key from env — rejected, the key-rotation story is painful. Application-layer crypto — rejected, same reason.

**Trade-off:** Slight lock-in to Supabase. Acceptable.

**Reversibility:** Medium. Re-encrypting all tokens with a different scheme is a one-off migration.

---

## 2026-04-22: `FOR UPDATE SKIP LOCKED` for the scheduled-publish claim

**Decision:** The cron's claim query uses `SELECT ... FOR UPDATE SKIP LOCKED` in a CTE, wrapped in the UPDATE. Not an advisory lock, not a plain conditional UPDATE.

**Why:** It's the Postgres-native pattern for distributed queues. Two workers claiming the same batch both succeed on disjoint rows without retries. Advisory locks are coarser and easier to leak.

**Alternatives considered:** Upstash QStash (deferred to V2 if cron becomes a bottleneck), advisory locks, plain conditional UPDATE (works but wastes work on conflict).

**Trade-off:** A tiny bit more SQL complexity.

**Reversibility:** Cheap.

---