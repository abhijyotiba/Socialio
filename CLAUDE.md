# SocialOS — Context for Claude

> **Read this file first, every session.** It is the operating manual for the project.

---

## A. Behavioral guidelines

Behavioral baseline for working in this repo. Project-specific rules in part B override these on conflict.

**Tradeoff:** these guidelines bias toward caution over speed. For trivial tasks, use judgment.

### A.1 Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### A.2 Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### A.3 Surgical changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it without permission.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### A.4 Goal-driven execution

Define success criteria. Loop until verified.

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

# B. SocialOS project context

## B.1 What this is

SocialOS is a multi-tenant SaaS web application. A user signs up, connects their LinkedIn and X/Twitter accounts, and gives the app either a URL, a raw idea, or (later) a connected data source. The app extracts the source content, uses AI to generate a brand-aligned social media post, and then either publishes immediately or schedules it for later. The product's wedge is a **chat-first interface** combined with a **versioned brand system prompt** — most competitors are form-based with a hidden prompt.

Tech-wise it's a Next.js 16 web app + Supabase (Postgres, Auth, Vault) + a Python FastAPI "worker" service that owns scraping, AI generation, OAuth token exchange, media upload to Cloudinary, mutations, and cron jobs.

The full product vision lives in [docs/SocialOS_PRD_v1.1.md](docs/SocialOS_PRD_v1.1.md). The current V2 plan and assessment of what's shipped lives in [SOCIALOS_V2_PLAN.md](SOCIALOS_V2_PLAN.md). Local dev setup is in [Local_Running.md](Local_Running.md).

## B.2 Current state

Late-beta. The full happy path (signup → brand → connect → ingest URL → generate → schedule → publish → pull metrics) works end-to-end. Multi-tenant is real (RLS enforced), tokens are vaulted, publishing is idempotent, the cron handles concurrency correctly.

**The backend migration is essentially complete.** All scraping, AI generation, OAuth callbacks, media upload (Cloudinary), cron, and every mutation route (ingestion, generation, campaigns, personas, brand/voice, manual publish, post edits/schedule/cancel/revert, schedule slots) live in [worker/](worker/). The Next.js app is now a thin auth-and-proxy layer plus the React UI and read-only routes that query Supabase under user RLS.

**Web responsibilities** (post-migration):
- React UI, Server Components, client islands for interactivity
- Supabase session cookie via [proxy.ts](web/proxy.ts) and `lib/supabase/server.ts`
- Read-only API routes (`/api/queue`, `/api/profile`, `/api/metrics`, `/api/connections`, etc.) — query the DB through `lib/db/*` helpers under RLS
- Thin proxy routes that forward POST/PATCH/PUT/DELETE to the worker with the user's JWT + HMAC signature

**Worker responsibilities**:
- Owns the service role key (Vault writes), Cloudinary creds, LinkedIn/X client secrets, LLM API keys
- All mutations under the user's RLS via JWT forwarding
- Cron (publish-due, token refresh, cleanup-orphaned-media, pull-metrics)
- LLM orchestration (Groq primary, Gemini fallback)

## B.3 Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind CSS v4 | No Pages Router. UI primitives are shadcn-vendored locally + `@base-ui/react` for button/input. |
| Web backend | Next.js Route Handlers (`web/app/api/**`) | Auth, OAuth redirects, read paths, thin proxies. No mutations, no third-party SDKs. |
| Python worker | FastAPI + uv-managed venv | Scraping, AI, OAuth, all mutations, cron. Single deployable. |
| Scraping | Firecrawl (via worker adapter) | Playwright removed — Firecrawl handles it. |
| DB + Auth | Supabase (Postgres + Auth + Vault) | RLS enabled on every table. Vault for OAuth tokens. |
| Media | Cloudinary | Signed uploads handled by the worker only. |
| LLM | Groq (primary), Google Gemini (fallback) | Single `generate()` entrypoint in `worker/adapters/llm.py`. |
| Web hosting | **Netlify** (see [web/netlify.toml](web/netlify.toml)) | Uses `@netlify/plugin-nextjs`. |
| Worker hosting | Fly.io ([worker/fly.toml](worker/fly.toml)) — Render config also present | |
| Package managers | pnpm 10 (web), uv (worker) | Lockfiles committed. |

Adding a new runtime dependency (npm or pip) requires user approval. Do not silently install things.

## B.4 Repo layout

```
socialos/
├── CLAUDE.md                   # You are here
├── README.md                   # Human-facing intro
├── Local_Running.md            # Dev setup + commands
├── SOCIALOS_V2_PLAN.md         # Current strategy + what's shipped
├── audit.md                    # Recent architecture/dead-code audit
├── improvement.md / Future improvements   # Ad-hoc planning notes
├── docs/
│   ├── SocialOS_PRD_v1.1.md    # Product vision (V1.1)
│   └── phases/                 # Per-phase plans (Current/, completed/)
├── web/                        # Next.js 16 app — see B.5
├── worker/                     # FastAPI service — see B.6
└── supabase/                   # Migrations live here when added
```

## B.5 web/ layout

```
web/
├── proxy.ts                    # Next.js middleware convention (renamed in Next 16)
├── app/
│   ├── (app)/                  # Auth-gated routes — dashboard/queue/profile are SERVER COMPONENTS
│   ├── (auth)/                 # /login, /signup
│   └── api/                    # Route handlers — see conventions in B.7
├── components/                 # Sidebar, settings forms, shadcn-vendored ui/
├── lib/
│   ├── auth/                   # persona-guard, header-derived user helper
│   ├── constants/              # Platforms + limits
│   ├── db/                     # ALL Supabase queries live here (see B.7)
│   ├── hooks/                  # useNowPlusMinutes
│   ├── observability/          # logError → worker
│   ├── supabase/               # client (browser), server (RSC), middleware (proxy helper)
│   ├── env.ts                  # Asserts the 4 required env vars at boot
│   ├── utils.ts                # cn()
│   └── worker-client.ts        # signed HMAC + JWT fetch to the worker
└── tests/                      # Vitest — no live Supabase required
```

## B.6 worker/ layout

```
worker/
├── main.py                     # FastAPI app factory + router mount
├── config.py                   # Env loading
├── auth.py                     # JWT validation + HMAC verification
├── adapters/                   # cloudinary, firecrawl, gemini, groq, linkedin, x, llm
├── routes/                     # brand, campaigns, cron, ingest, media, oauth, personas,
│                               # posts, schedule_slots, system
├── pipeline/                   # extract, scrape, upload, analyze, generate, regenerate, voice_profile
├── publish/                    # upload_media
├── db/                         # Per-table query helpers (mirror of web/lib/db)
├── cron/jobs.py                # Cron handlers
├── security/                   # SSRF guard etc.
└── tests/                      # pytest
```

## B.7 Conventions — enforced

These are bugs when violated.

### TypeScript
- `strict: true` in tsconfig. No `any` without a `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason:` comment.
- DB types in [web/lib/db/types.ts](web/lib/db/types.ts) are generated via `pnpm gen:types`. Do not hand-edit.

### Zod usage
- **Use Zod** when a route handler reads specific fields from the body or uses them locally (e.g. [web/app/api/posts/[id]/route.ts](web/app/api/posts/[id]/route.ts) PATCH).
- **Skip Zod** for pure thin-proxy routes that forward the whole body to the worker — the worker re-validates with Pydantic and duplicating the schema invites drift. A `request.json().catch(() => null)` null check is enough.

### Database access
- **Every Supabase call goes through a function in `web/lib/db/`.** Route handlers and Server Components do not call `supabase.from(...)` directly. The only `supabase` usage allowed at the route level is auth (`supabase.auth.getUser()` / `getSession()`).
- Two Supabase clients exist, and only two:
  - [web/lib/supabase/server.ts](web/lib/supabase/server.ts) — user-scoped, JWT-bound, respects RLS. Used by route handlers and Server Components.
  - [web/lib/supabase/client.ts](web/lib/supabase/client.ts) — browser client for client islands.
- **The web app does not have an admin client.** The service role key lives in the worker only. Anything that needs to bypass RLS belongs in the worker.

### Routing
- **Mutation routes are thin proxies.** Read [web/lib/worker-client.ts](web/lib/worker-client.ts) before adding a new mutation — there's almost certainly a helper to reuse. New mutations get a worker endpoint first; the web route is the proxy.
- **Read pages favour Server Components.** Look at [web/app/(app)/dashboard/page.tsx](web/app/(app)/dashboard/page.tsx), [queue/page.tsx](web/app/(app)/queue/page.tsx), and [profile/page.tsx](web/app/(app)/profile/page.tsx) for the pattern: server fetch via `lib/db/*`, small client islands in `_components/` for the interactive bits. Don't make the whole page `"use client"` to wrap one button.
- Filter/tab UI uses URL search params (`?tab=x`, `?persona_id=…`) rather than client state. Bookmarkable, no extra round-trip.

### External APIs
- Every third-party API (LinkedIn, X, Cloudinary, Groq, Gemini, Firecrawl) has an adapter file in `worker/adapters/`. Route handlers and pipeline modules never call `fetch("https://api.linkedin.com/...")` directly.
- The web app should not import any third-party SDK that talks to a non-Supabase external service. That's the worker's job.

### Schema changes
- Every DB change = (1) write a numbered migration in `supabase/migrations/`, (2) regenerate TS types with `pnpm gen:types`, (3) update the V2 plan or PRD if the change is user-visible. Same commit.
- Every new table has RLS enabled in its migration. No exceptions.
- Brand prompts are versioned. Never `UPDATE brand_configs.custom_system_prompt` in place. Always `INSERT INTO prompt_versions` with a new version number. Every post references the specific `prompt_version_id` it was generated with.

### Secrets
- Every env var goes in `.env.example` with an empty value and a one-line comment.
- Never log token values. Mask to first-6-last-4 if debugging.

### Tests
- Vitest for `web/`, pytest for `worker/`.
- Tests must not require a live Supabase connection. Use mocks.

### Commits
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`.
- Commit after every working increment. "Working" = `pnpm typecheck` clean + `pnpm test` green.

## B.8 How to run locally

See [Local_Running.md](Local_Running.md) for the full setup. Short version:

```bash
# One-time
pnpm install --dir web
cd worker && uv sync && cd ..
cp .env.example web/.env.local       # fill in the 4 required vars (see B.9)
cp .env.example worker/.env          # fill in worker secrets

# Dev (two terminals)
pnpm --dir web dev                   # http://localhost:3000
cd worker && uv run fastapi dev      # http://localhost:8000
```

You need a Supabase project (free tier is fine), Cloudinary, Groq, Gemini, and Firecrawl accounts.

## B.9 Environment variables

### Web — only 4 are required ([web/lib/env.ts](web/lib/env.ts))

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase client |
| `WORKER_URL` | Where the worker lives (`http://localhost:8000` in dev) |
| `WORKER_SHARED_SECRET` | HMAC secret. Web signs requests; worker verifies. Prevents random traffic from hitting worker endpoints. |

The web app **does not need** the service role key, Cloudinary creds, OAuth client secrets, LLM keys, or `CRON_SECRET`. Those moved to the worker. If you find yourself needing one of those in `web/`, you're probably building something that belongs in the worker.

### Worker
Owns `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_*`, `LINKEDIN_*`, `X_*`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, `CRON_SECRET`, `WORKER_SHARED_SECRET`. See `worker/config.py`.

## B.10 Files to read before making changes

1. This file (CLAUDE.md).
2. [SOCIALOS_V2_PLAN.md](SOCIALOS_V2_PLAN.md) — current state assessment + what's planned.
3. The file you're about to edit, plus its direct imports and importers (grep the export name).

For broader context when needed: [docs/SocialOS_PRD_v1.1.md](docs/SocialOS_PRD_v1.1.md) (product vision), [audit.md](audit.md) and [frontend_backend_analysis.md](frontend_backend_analysis.md) (recent architectural cleanup notes).

The old `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/DECISIONS.md`, `docs/SESSION_NOTES.md`, `docs/BACKLOG.md`, and `docs/ARCHITECTURE_MIGRATION_PLAN.md` referenced in older session notes **no longer exist**. The DB schema lives in `web/lib/db/types.ts` (generated) and `supabase/migrations/`. Decisions and session notes are tracked in commit messages and PR descriptions now.

## B.11 Known decisions & gotchas

- **We do not scrape LinkedIn.** Multi-tenant LinkedIn scraping violates ToS. Ingesting *from* a LinkedIn URL means the user pastes the post text themselves.
- **Brand prompts are versioned.** Never `UPDATE brand_configs.custom_system_prompt` in place.
- **Publisher uses `FOR UPDATE SKIP LOCKED`** for the claim query. This is the Postgres-native distributed-queue pattern. Do not "simplify" it.
- **Publish requests use idempotency keys.** Idempotency key is `post_variant.id`. Sent to LinkedIn via `X-RestLi-Request-Id`. For X (no idempotency support), check `publish_attempts` before retrying.
- **Workspace-scoped, not user-scoped.** All data is scoped to `workspace_id` via a `workspace_members` join table.
- **Posts split into `content_items` + `post_variants`.** One logical "content piece" can have multiple platform-specific variants.
- **Token encryption uses Supabase Vault.** Not our own AES-256 code. Not pgcrypto.

## B.12 What Claude must NOT do without asking

- Install a new npm or pip package.
- Create a new top-level folder.
- Modify or drop a DB column that's already in a migration.
- Refactor files not directly related to the current task ("while I'm here…" is how projects die).
- Rename a public API route or exported function that other code depends on.
- Change CLAUDE.md, SOCIALOS_V2_PLAN.md, or the PRD without explicit direction.
- Push directly to `main` — always go via a branch.
- Re-introduce the service role key, Cloudinary, or third-party OAuth secrets into the web app. They belong in the worker.
- Make a page `"use client"` just to wrap one interactive button. Extract a small client island in `_components/` instead.

If tempted, stop and ask. "I noticed X should probably be refactored, want me to do it?" is always better than doing it.

## B.13 Session hygiene

**Start of session:**
1. Read this file.
2. `git status` and `git log --oneline -10`. Understand where things are.
3. If the user's request is ambiguous, ask before writing code.

**During:**
- Commit after every working increment.
- If you notice something out of scope, mention it — don't fix it.
- If you hit an unspecified decision, ask — don't guess.

**End of session:**
1. Run `pnpm typecheck` + `pnpm test` (web) and `pytest` (worker if changed). All green before claiming done.
2. Commit (don't push to main).
