# Session Notes

Append-only handoff between Claude Code sessions. **Newest entry at the top.**

At the end of every session, add a new entry with:

- Date
- What got built
- What's left in the current phase
- Decisions made (also log in `DECISIONS.md` if architectural)
- Gotchas hit or pitfalls to watch for
- Exact next-step command or first action for the next session

---

## 2026-04-23 — Phase 3 complete: AI generation pipeline

**What got built:**

- Migrations `0004_generation.sql` + `0005_content_items_indexes.sql` — `content_items`, `post_variants` tables with RLS, indexes, trigger
- Worker LLM adapters: `worker/adapters/groq.py`, `worker/adapters/gemini.py`, `worker/adapters/llm.py` (Groq primary, Gemini fallback)
- Worker pipeline: `worker/pipeline/analyze.py` (Pass 1: source → summary), `worker/pipeline/generate.py` (Pass 2: summary → platform variants)
- Worker route: `worker/routes/generate.py` — `POST /generate`
- Web: `workerGenerate()` added to `worker-client.ts`
- Web db layer: `web/lib/db/posts.ts` — `createContentItem`, `updateContentItem`, `createPostVariants`, `getContentItemWithVariants`, `listContentItemsForJob`
- Web db layer: `web/lib/db/brand.ts` — `getBrandConfig`
- Web route: `web/app/api/posts/route.ts` — `POST /api/posts` with full auth + Zod + stage tracking
- Browser Supabase client: `web/lib/supabase/browser.ts`
- Chat UI: full generation flow — platform picker, Realtime stage labels, variant display, Copy button

**Confirmed working:**

- `pnpm --dir web typecheck` — 0 errors
- `pnpm --dir web test` — 21/21 passing
- `cd worker && uv run pytest tests/` — 28/28 passing
- Both migrations applied to remote Supabase

**Decisions made:**

- Groq primary / Gemini fallback (see DECISIONS.md)
- Generation synchronous in Phase 3 (see DECISIONS.md)

**Gotchas:**

- `getBrandConfig` was missing from `web/lib/db/brand.ts` — had to create the file
- `google-generativeai` is deprecated (EOL) — tracked in `docs/BACKLOG.md`, must migrate to `google-genai` before production
- Supabase Realtime stage updates require the `ingestion_jobs` table to have replica identity; Supabase enables this by default on new projects
- `content_items` initially had only 2 indexes — added `0005_content_items_indexes.sql` to add the missing `prompt_version_id` and `created_at` indexes

**What's next (Phase 4 — Publishing):**

- X OAuth (start + callback routes, adapter)
- `publish_attempts` table
- `POST /api/posts/[id]/publish` (publish now)
- `POST /api/posts/[id]/schedule` (schedule)
- Cron: `POST /api/cron/publish-due`
- Enable "Publish now" and "Schedule" buttons in the UI

---

## 2026-04-23 — Phase 2 complete: Ingestion pipeline end-to-end

**What got built:**

- Migration `0003_ingestion.sql` applied — `ingestion_jobs`, `media_assets` tables with RLS; 5 indexes
- `web/lib/db/types.ts` regenerated; both new tables present
- Python worker scaffold:
  - `worker/pyproject.toml` + `uv.lock` (uv sync completed; 39 packages installed)
  - `worker/config.py` — pydantic-settings with lazy `get_settings()` + `@lru_cache`
  - `worker/auth.py` — HMAC-SHA256 verification (`X-Worker-Signature: sha256=<hex>`)
  - `worker/main.py` — FastAPI app with `/health` and ingest router
  - `worker/pipeline/scrape.py` — DNS-based SSRF guard + Playwright one-browser-per-request
  - `worker/pipeline/extract.py` — BeautifulSoup: og:title → title → h1; strip nav/footer/scripts; og:image + img[src] up to 5; relative URL resolution
  - `worker/pipeline/upload.py` — Cloudinary upload with non-fatal per-image error handling
  - `worker/routes/ingest.py` — thin route, delegates to pipeline; returns `IngestResponse` with `stage_timings`
  - `worker/tests/conftest.py` — sets dummy env vars before collection (no live creds needed)
  - `worker/tests/test_extract.py` — 9 tests covering title fallback, media ordering, nav stripping, relative URLs, max-5 cap
  - `worker/tests/test_ssrf.py` — 8 tests covering loopback, RFC-1918 ranges, AWS metadata, DNS failure, missing hostname
  - `worker/Dockerfile` + `worker/fly.toml`
- Web layer:
  - `web/lib/worker-client.ts` — HMAC-signed typed fetch client
  - `web/lib/db/ingestion.ts` — `createIngestionJob`, `updateIngestionJob`, `getIngestionJob`, `countRecentJobs`
  - `web/lib/db/media-assets.ts` — `createMediaAssets`, `getMediaAssetsForJob`
  - `web/app/api/ingest/route.ts` — POST: Zod validation, LinkedIn guard, rate-limit (2/min, 50/day), synchronous worker call, status updates
  - `web/app/api/ingest/[job_id]/route.ts` — GET with explicit workspace ownership check
- Chat UI:
  - `web/app/(app)/chat/page.tsx` — client component; `idle → loading → success | error` states; extracted title + text preview (400 char + "Show more") + Cloudinary thumbnail grid; disabled "Generate post →" with tooltip; ⌘+Enter submit
- Tests:
  - `web/tests/db.ingestion.test.ts` — 7 type-level Vitest tests for `ingestion_jobs` and `media_assets`
- Docs updated: `DATA_MODEL.md` (Phase 2 section), `API_CONTRACTS.md` (Phase 2 section), `.env.example` (`WORKER_URL`, `WORKER_SHARED_SECRET`)

**Confirmed working:**

- `pnpm --dir web typecheck` — passes (0 errors)
- `pnpm --dir web test` — 17/17 tests pass
- `cd worker && uv run pytest tests/` — 17/17 tests pass
- `pnpm --dir web supabase db push --workdir ..` — migration applied cleanly
- `pnpm --dir web gen:types` — types regenerated with `ingestion_jobs` and `media_assets`

**Decisions made:**

- `config.py` uses `@lru_cache` on `get_settings()` so tests can set env vars in `conftest.py` before the first import triggers `Settings()`. Avoids having to mock pydantic-settings.
- `extract.py` takes a `base_url` parameter so relative image src values can be resolved against the page origin. Without it, relative URLs are silently skipped (no crash).
- Chat page uses a single `InputForm` component rendered in three states (idle, error, success) rather than duplicating the textarea. Keeps the re-submit flow clean.
- Phase 2 route is synchronous (waits for worker). Phase 3 will switch to async + Supabase Realtime when LLM calls extend total time to 10–20s.

**What's next (Phase 3 — Generation):**

- `content_items` and `post_variants` tables (migration 0004)
- Worker `/generate` endpoint: Pass 1 (LLM summarize source) + Pass 2 (LLM generate platform variants)
- `web/lib/adapters/` LLM adapter (Groq primary, Gemini fallback)
- Switch ingest route to async + Supabase Realtime stage updates
- Enable "Generate post →" button on the chat page

**Gotchas to watch:**

- `uv.lock` must be committed — Fly.io build depends on it for reproducibility.
- `worker/.env` (gitignored) must be created locally with real `WORKER_SHARED_SECRET` + `CLOUDINARY_*` values before `uv run fastapi dev` works.
- Vercel Hobby function timeout is 10s — scraping fast pages is fine but slow blogs may exceed it. If this becomes a problem on Hobby, upgrade to Pro (60s timeout) before Phase 3.
- The `worker/tests/conftest.py` only sets dummy values; Cloudinary upload tests in Phase 3 will need a real creds strategy (env-based skip or VCR cassettes).

---

## 2026-04-22 — Phase 1 complete: Auth, Brand, and LinkedIn OAuth

**What got built:**

- Migration `0002_brand_and_connections.sql` applied — `brand_configs`, `prompt_versions`, `social_connections` tables with RLS; `touch_updated_at()` trigger; `vault_create_secret` / `vault_read_secret` SQL helpers (service_role only)
- `web/lib/db/types.ts` regenerated; all three new tables present
- `web/lib/security/vault.ts` — Supabase Vault helpers (create/read secrets via admin client RPC)
- `web/lib/db/brand-configs.ts` — `getBrandConfig`, `upsertBrandConfig`
- `web/lib/db/prompt-versions.ts` — `createPromptVersion` (auto-increments version_number), `getLatestPromptVersion`
- `web/lib/db/social-connections.ts` — `getSocialConnection`, `upsertSocialConnection` (accepts optional client override for OAuth callback)
- `web/lib/adapters/linkedin.ts` — `buildAuthorizationUrl`, `exchangeCodeForTokens`, `getUserInfo` with Zod validation
- `web/app/api/brand/config/route.ts` — GET (read current config) + POST (upsert + new prompt version)
- `web/app/api/oauth/linkedin/start/route.ts` — generates state, sets httpOnly cookie, redirects to LinkedIn
- `web/app/api/oauth/linkedin/callback/route.ts` — validates state, exchanges code, stores tokens in Vault, upserts social_connections
- `web/app/(app)/layout.tsx` — onboarding gate: checks `brand_configs` and redirects to `/onboarding` if missing
- `web/lib/supabase/middleware.ts` — injects `x-pathname` header so the layout can read current route without a client hook
- `web/app/(app)/onboarding/page.tsx` + 3 step components (`BrandStep`, `ConnectStep`, `TestPostStep`)
- `web/app/(app)/settings/brand/page.tsx` — client component, fetches + saves brand config
- `web/app/(app)/settings/connections/page.tsx` — server component, shows LinkedIn connection status
- `components/ui/textarea.tsx` added via shadcn (needed by brand forms)
- Tests: `db.brand-configs.test.ts` (type-level, 3 tests), `adapters.linkedin.test.ts` (4 tests) — 11/11 pass
- `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/BACKLOG.md` updated
- Google OAuth deferred to `docs/BACKLOG.md`

**Confirmed working:**

- `pnpm --dir web typecheck` — passes (0 errors)
- `pnpm --dir web test` — 11/11 tests pass
- `pnpm supabase db push --workdir ..` — migration applied cleanly

**Decisions made:**

- `lib/security/vault.ts` accepts a `SupabaseClient` parameter rather than importing `createAdminClient` directly, keeping admin import rule contained to route files
- `upsertSocialConnection` accepts an optional `clientOverride` parameter so the OAuth callback (which already holds an admin client) can pass it without a second client instantiation
- Onboarding gate uses `x-pathname` header injected by middleware rather than a separate nested route group
- Google OAuth skipped per user instruction; noted in BACKLOG.md

**What's next (Phase 2 — Ingestion):**

- Write `docs/phases/PHASE_2_INGESTION.md` brief before starting code
- Python worker scaffold: FastAPI, `routes/ingest.py`, Playwright scraping, Cloudinary upload
- `web/app/api/ingest/route.ts` — creates `ingestion_jobs` row, calls worker, updates status
- `ingestion_jobs` and `media_assets` tables (migration 0003)
- Chat UI (`/chat`) with URL input and job status polling

**Gotchas to watch:**

- The onboarding gate in `(app)/layout.tsx` does two sequential DB queries (workspace + brand_config) on every protected page load. Fine for V1; consider caching in Phase 5+ if latency becomes an issue.
- `vault_create_secret` is called once per token, so a LinkedIn connect creates 1–2 vault entries. If the connection is re-established, old vault entries become orphaned (no automatic cleanup). Add a cleanup step if Vault storage becomes a concern.
- `upsertSocialConnection` with `onConflict: 'workspace_id,platform'` requires the unique constraint name to match exactly. Verified it's `social_connections_workspace_platform_unique` in the migration.

---

## 2026-04-22 — Phase 0 closeout + Phase 1 brief authored

**What got built / finalized:**

- Supabase CLI login and project linking verified for project `igrzkqtidqjwmxzqlawm`
- Foundation migration `0001_foundation.sql` applied against the correct repo root workdir (`--workdir ..`)
- Confirmed remote schema now includes `profiles`, `workspaces`, and `workspace_members`
- Regenerated `web/lib/db/types.ts` from real schema; verified Phase 0 tables appear in generated types
- Added complete Phase 1 implementation brief in `docs/phases/PHASE_1_AUTH_BRAND.md`

**What's confirmed working:**

- `pnpm --dir web typecheck` passes
- `pnpm --dir web test` passes
- `pnpm supabase db push --workdir ..` applies foundation migration cleanly
- `pnpm --dir web gen:types` / `pnpm exec supabase gen types ...` produce valid TypeScript definitions

**What's next:**

- Start Phase 1 implementation from the new brief:
	onboarding wizard, Google login button, LinkedIn OAuth routes, `0002_brand_and_connections.sql`, and settings pages.

---

## 2026-04-22 — Phase 0 implementation

**What got built:**

- Next.js 16.2.4 app scaffolded in `web/` (TypeScript strict, Tailwind v4, App Router, pnpm)
- `lib/supabase/{server,admin,client,middleware}.ts` — three-client Supabase setup using `@supabase/ssr` with `getAll`/`setAll` cookie pattern; `cookies()` is async in Next.js 16 and awaited correctly
- `middleware.ts` at repo root — session refresh on every request; redirects logged-out users to `/login` and logged-in users away from auth pages
- `app/(auth)/` route group — `/login` and `/signup` pages (email/password, shadcn/ui), email confirmation callback at `/auth/callback`
- `app/(app)/` route group — server-side auth guard in layout, `/dashboard` showing "Hello, {user.email}", `TopBar` client component with logout
- `lib/db/types.ts` — generated from real Supabase schema via `pnpm gen:types`; `scripts/gen-types.mjs` helper avoids PowerShell UTF-16 encoding issue
- `lib/db/workspaces.ts` — `getWorkspaceForUser()` db helper
- `supabase/migrations/0001_foundation.sql` — `profiles`, `workspaces`, `workspace_members` tables; RLS policies; `user_workspace_ids()` fn; `handle_new_user()` signup trigger; applied to Supabase project via `db push`
- `tests/smoke.test.ts` + `vitest.config.ts` — 3/3 passing
- `.github/workflows/ci.yml` — typecheck + test on push/PR to main
- shadcn/ui: button, input, label, card components; Supabase CLI installed as local dev dep (`pnpm supabase`)

**Decisions made:**

- Accepted Next.js 16.2.4 (latest at time of build) instead of 15; updated CLAUDE.md and ARCHITECTURE.md accordingly
- Supabase CLI installed as local pnpm dev dependency (no global install); `pnpm.onlyBuiltDependencies` used to allow its postinstall binary download

**What's left in Phase 0 (not code — needs manual verification):**

- [ ] `pnpm --dir web dev` starts locally and smoke-test the signup/login/dashboard/logout flow end-to-end
- [ ] Verify signup trigger fires (check Supabase Table Editor for profiles/workspaces/workspace_members rows)
- [ ] CI passes on a pushed PR
- [ ] Vercel deployment with env vars set

**Next session's first action:** Read CLAUDE.md (now Phase 1), ARCHITECTURE.md, DATA_MODEL.md, `docs/phases/PHASE_1_AUTH_BRAND.md`, and top of SESSION_NOTES.md. Phase 1 adds Google OAuth login, onboarding wizard, brand config CRUD, and prompt versioning.

**Gotchas to remember:**

- `cookies()` from `next/headers` returns a Promise in Next.js 16 — always `await` it before passing to `createServerClient`
- PowerShell `>` writes UTF-16; always use `pnpm gen:types` (the Node.js helper script) to regenerate types, never raw PowerShell redirection
- Supabase CLI runs as `pnpm supabase <cmd>` from inside `web/`; `supabase link` must be run before `db push` or `gen types`
- The `(app)/layout.tsx` does a server-side `auth.getUser()` check — this is intentional redundancy on top of middleware for defence-in-depth

---

## 2026-04-22 — Scaffolding (pre-code)

**What got built:** Repo scaffolding only. No code yet.

- `CLAUDE.md` — project operating manual
- `docs/ARCHITECTURE.md` — stack, folder layouts, patterns, request lifecycle
- `docs/DATA_MODEL.md` — Phase 0 schema (profiles, workspaces, workspace_members) and conventions for future tables
- `docs/API_CONTRACTS.md` — empty placeholder, will grow per phase
- `docs/DECISIONS.md` — pre-seeded with 8 foundational decisions (stack, no LangGraph, no LinkedIn scraping, workspaces-from-day-one, prompt versioning, content_items/post_variants split, Vault for tokens, SKIP LOCKED for cron claim)
- `docs/phases/PHASE_0_FOUNDATION.md` — detailed brief for Phase 0
- `docs/BACKLOG.md` — empty
- `.env.example` — all vars across all phases, empty values
- `README.md` — human-facing quickstart

**What's left in the current phase (Phase 0):** Everything. No code has been written.

**Next session's first action:** Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/phases/PHASE_0_FOUNDATION.md`. Then summarize back the plan and ask any clarifying questions before scaffolding the Next.js app.

**Gotchas to remember for the first coding session:**

- Use `@supabase/ssr`, not the deprecated `@supabase/auth-helpers-nextjs`.
- The signup trigger function needs `SECURITY DEFINER` or it won't be able to insert into `workspaces`.
- Tailwind must be installed *before* `npx shadcn@latest init`.
- Remember to run `supabase login` and `supabase link --project-ref ...` before generating types.
- Commit after every working increment — every green `pnpm typecheck` is a valid checkpoint.

---