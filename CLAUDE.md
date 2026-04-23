# SocialOS — Context for Claude

> **Read this file first, every session.** It is the operating manual for the project.

---

## 1. What this is

SocialOS is a multi-tenant SaaS web application. A user signs up, connects their LinkedIn and X/Twitter accounts, and gives the app either a URL, a raw idea, or (later) a connected data source. The app extracts the source content, uses AI to generate a brand-aligned social media post, and then either publishes immediately or schedules it for later. The product's wedge is a **chat-first interface** combined with a **versioned brand system prompt** — most competitors are form-based with a hidden prompt.

Tech-wise it's a Next.js 15 web app + Supabase (Postgres, Auth, Storage) + a small Python FastAPI "worker" service that handles the two things Node is bad at (Playwright scraping and LLM orchestration) + Cloudinary for media.

The full product vision lives in `docs/PRD.md`. The current architecture lives in `docs/ARCHITECTURE.md`. The schema lives in `docs/DATA_MODEL.md`. Read those before making changes.

---

## 2. Current phase

**Phase 5 — Scheduling & Cron.** Phase 4 (Publishing) is complete. See `docs/phases/PHASE_4_PUBLISHING.md` for what was built.

When a phase changes, update this line. Do **not** modify files outside the current phase's scope without explicit permission from the user.

---

## 3. Stack — non-negotiable for V1

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui | No Pages Router, no alternate UI kits |
| Web backend | Next.js Route Handlers (`app/api/**`) | CRUD, auth, OAuth callbacks, cron, webhook receivers |
| Python worker | FastAPI + Playwright + LLM SDKs | Scraping and AI generation only |
| DB + Auth | Supabase (Postgres + Auth) | RLS enabled on every table |
| Media | Cloudinary | Signed server-side uploads only |
| LLM | Groq (primary), Google Gemini (fallback) | Accessed via a single `generate()` function in the worker |
| Web hosting | Vercel | |
| Worker hosting | Fly.io | |
| Package managers | pnpm (web), uv (worker) | Lockfiles committed |

Adding a new runtime dependency (npm or pip package) requires a one-line note in `docs/DECISIONS.md` and user approval. Do not silently install things.

---

## 4. Repo layout

```
socialos/
├── CLAUDE.md                 # You are here
├── README.md                 # Human-facing intro + quickstart
├── .env.example              # All env vars, empty values
├── docs/                     # Source of truth for product + architecture
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md         # Every table, column, index, RLS policy
│   ├── API_CONTRACTS.md      # Every HTTP endpoint
│   ├── DECISIONS.md          # Append-only architectural decision log
│   ├── SESSION_NOTES.md      # Append-only session handoff notes
│   ├── BACKLOG.md            # Stuff noticed during a phase that belongs elsewhere
│   └── phases/
│       ├── PHASE_0_FOUNDATION.md
│       ├── PHASE_1_AUTH_BRAND.md
│       └── ...
├── web/                      # Next.js app (created in Phase 0)
├── worker/                   # Python FastAPI service (created in Phase 2)
└── supabase/
    └── migrations/           # SQL migrations, numbered
```

Rule: **CRUD logic lives in `web/`. Scraping and LLM calls live in `worker/`.** If you're tempted to put business logic in both places, stop and ask.

---

## 5. Conventions — enforced

These are not suggestions. Violations are bugs.

**TypeScript**
- `strict: true` in tsconfig. No `any` without a `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason:` comment.
- Zod schemas for every API request body and external API response.
- All types that match DB tables are generated via `supabase gen types typescript` into `web/lib/db/types.ts`. Do not hand-write them.

**Database access**
- Every Supabase call in the web app goes through a function in `web/lib/db/`. Route handlers do not call `supabase.from(...)` directly.
- Two Supabase clients exist, and only two:
  - `web/lib/supabase/server.ts` — user-scoped, uses the user's JWT, respects RLS. Used in route handlers and Server Components.
  - `web/lib/supabase/admin.ts` — service role, bypasses RLS. May only be imported in `web/app/api/cron/**` and `web/app/api/oauth/**/callback/route.ts`. Nowhere else. A CI check enforces this.

**External APIs**
- Every third-party API (LinkedIn, X, Cloudinary, Groq, Gemini) has an adapter file in `web/lib/adapters/` or `worker/adapters/`. Route handlers and worker endpoints never call `fetch("https://api.linkedin.com/...")` directly.

**Schema changes**
- Every DB change = (1) update `docs/DATA_MODEL.md`, (2) write a numbered migration in `supabase/migrations/`, (3) regenerate TS types. All in the same commit.
- Every new table has RLS enabled in its migration. No exceptions.

**Secrets**
- Every env var goes in `.env.example` with an empty value and a one-line comment explaining what it is.
- Never log token values. Mask to first-6-last-4 if debugging.

**Tests**
- Vitest for `web/`, pytest for `worker/`.
- Write tests for: adapters, db-layer functions, and anything involving date math or the state machine. UI component tests are not required in V1.
- Running tests must not require a live Supabase connection. Use a test-mode adapter.

**Commits**
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Commit after every working increment. "Working" = app still runs + tests still pass.

---

## 6. How to run locally

```bash
# One-time setup
pnpm install --dir web
cd worker && uv sync && cd ..
cp .env.example .env.local
# Fill in .env.local — see "Environment variables" section below

# Dev
pnpm --dir web dev              # http://localhost:3000
cd worker && uv run fastapi dev # http://localhost:8000
```

You need a Supabase project (free tier is fine) and Cloudinary account before Phase 0 runs end-to-end.

---

## 7. Environment variables

Full list is in `.env.example`. Notes on the tricky ones:

- `SUPABASE_SERVICE_KEY` — goes in Vercel's encrypted env vars, never committed. Used only by cron and OAuth callback routes. Treat like a root password.
- `TOKEN_ENCRYPTION_KEY` — 32-byte hex, for encrypting stored OAuth tokens. Generate with `openssl rand -hex 32`. If it changes, all existing tokens become unreadable. Plan rotation accordingly.
- `CRON_SECRET` — random string. Every `/api/cron/**` route verifies the `Authorization: Bearer $CRON_SECRET` header before doing anything.
- `WORKER_URL` — where the Python worker lives. `http://localhost:8000` in dev, the Fly.io URL in prod.
- `WORKER_SHARED_SECRET` — HMAC secret. Web signs requests to the worker, worker verifies. Prevents random internet traffic from hitting `/ingest`.

---

## 8. Files Claude must read before making changes

At the start of every session, read in this order:

1. `CLAUDE.md` (this file)
2. `docs/ARCHITECTURE.md`
3. `docs/DATA_MODEL.md`
4. The current phase doc (see section 2)
5. `docs/SESSION_NOTES.md` (top entry only — this is the handoff from the last session)

Before editing any specific file, also read:

- The file itself
- Files it imports
- Files that import it (grep for the export name)

---

## 9. Known decisions & gotchas

Read `docs/DECISIONS.md` for the full list. High-impact ones repeated here because violating them creates expensive-to-unwind bugs:

- **We do not scrape LinkedIn.** Multi-tenant LinkedIn scraping violates their ToS and we have seen them sue over it. Ingesting *from* a LinkedIn URL means the user pastes the post text themselves. Ingesting from other sites (TechCrunch, YouTube title/description, random blogs) via Playwright is fine.
- **Brand prompts are versioned.** Never `UPDATE brand_configs.custom_system_prompt` in place. Always `INSERT INTO prompt_versions` with a new version number. Every post references the specific `prompt_version_id` it was generated with.
- **Publisher uses `FOR UPDATE SKIP LOCKED` for the claim query.** This is the Postgres-native pattern for a distributed queue. Do not "simplify" it to a plain UPDATE.
- **Publish requests use idempotency keys.** The idempotency key is `post_variant.id`. Sent to LinkedIn via `X-RestLi-Request-Id`. For X (no idempotency support), we check our `publish_attempts` table before retrying.
- **Workspace-scoped, not user-scoped.** Even in V1 where each user owns exactly one workspace, all data is scoped to `workspace_id` via a `workspace_members` join table. This avoids a painful migration when team support ships.
- **Posts are split into `content_items` + `post_variants`.** One logical "content piece" can have multiple platform-specific variants. Do not collapse them back into a single `posts` table.
- **Token encryption uses Supabase Vault.** Not our own AES-256 code. Not pgcrypto. Vault.

---

## 10. What Claude must NOT do without asking

- Install a new npm or pip package
- Create a new top-level folder
- Modify or drop a DB column that's already in a migration
- Touch files in a phase that is not the current phase
- Refactor files not directly related to the current task ("while I'm here…" is how projects die)
- Rename a public API route or exported function that other code depends on
- Change CLAUDE.md, ARCHITECTURE.md, or DATA_MODEL.md without explicit direction
- Push directly to `main` — always go via a branch

If tempted, stop and ask. Writing "I noticed X should probably be refactored, want me to do it?" is always better than doing it.

---

## 11. Session hygiene

**At session start:**
1. Read the files listed in §8.
2. Run `git status` and `git log --oneline -10`. Understand where we are.
3. Summarize back to the user: current phase, files that already exist for this phase, what's left based on the phase's acceptance criteria, and any open questions. Wait for confirmation before writing code.

**During the session:**
- Commit after every working increment.
- If you notice something out of phase scope, add it to `docs/BACKLOG.md` instead of fixing it.
- If you hit a decision that wasn't specified, ask — don't guess.

**At session end:**
1. Make sure the app runs and tests pass.
2. Update the current phase doc's checklist.
3. Append to `docs/SESSION_NOTES.md` (newest entry at top): date, what got done, what's next, any gotchas encountered.
4. If a non-obvious decision was made, append to `docs/DECISIONS.md`.
5. Commit and push.