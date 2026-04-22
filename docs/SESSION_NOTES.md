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