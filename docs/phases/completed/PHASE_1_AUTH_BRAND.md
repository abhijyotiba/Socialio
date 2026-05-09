# Phase 1 — Auth, Brand, and Connections

The goal of Phase 1 is to complete user onboarding and brand setup so every workspace has a connected account and a versioned prompt baseline. This phase adds OAuth connections and brand configuration, but does not add ingestion or AI generation.

If by the end of this phase a user can sign in with email or Google, complete a 3-step onboarding flow, connect LinkedIn, and save a versioned brand prompt — Phase 1 is done.

---

## Prerequisites — before starting the session

Do these before coding this phase.

- [ ] Phase 0 is fully complete and verified (auth flow, dashboard protection, migration 0001 applied)
- [ ] Supabase CLI is logged in and linked to the project ref
- [ ] LinkedIn OAuth app is created (client id, client secret, redirect URI)
- [ ] Google OAuth provider is enabled in Supabase Auth
- [ ] `.env.local` includes OAuth and encryption settings used in this phase

Helpful setup commands:

```bash
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web supabase link --project-ref YOUR_PROJECT_REF
```

---

## Goal

After this phase, a new user can authenticate (email/password or Google), complete onboarding (brand setup, connect account, test post), and persist a versioned brand prompt and LinkedIn connection state at workspace scope.

---

## Scope — what IS in this phase

- Google OAuth login button on `/login` and `/signup` via Supabase Auth
- Onboarding wizard with 3 steps:
	- Brand setup
	- Connect accounts
	- Test post (skippable)
- `brand_configs` table keyed by `workspace_id`
- `prompt_versions` table for append-only prompt history
- LinkedIn OAuth routes:
	- `GET /api/oauth/linkedin/start`
	- `GET /api/oauth/linkedin/callback`
- Token storage using Supabase Vault helpers (never plain token columns)
- Settings pages for:
	- Brand config
	- Connection status
- Migration `0002_brand_and_connections.sql`

## Scope — what is NOT in this phase

- URL ingestion pipeline (Phase 2)
- Python worker changes (Phase 2)
- AI draft generation (Phase 3)
- Publish now flow (Phase 4)
- Scheduler and cron publish flow (Phase 5)
- Advanced analytics and retries UI (Phase 6)

---

## Files to create

```
web/
├── app/
│   ├── (app)/
│   │   ├── onboarding/
│   │   │   ├── page.tsx
│   │   │   └── _components/
│   │   │       ├── BrandStep.tsx
│   │   │       ├── ConnectStep.tsx
│   │   │       └── TestPostStep.tsx
│   │   └── settings/
│   │       ├── brand/page.tsx
│   │       └── connections/page.tsx
│   └── api/
│       └── oauth/
│           └── linkedin/
│               ├── start/route.ts
│               └── callback/route.ts
├── lib/
│   ├── adapters/
│   │   └── linkedin.ts
│   ├── db/
│   │   ├── brand-configs.ts
│   │   ├── prompt-versions.ts
│   │   └── social-connections.ts
│   └── security/
│       └── vault.ts
└── tests/
		├── db.brand-configs.test.ts
		└── adapters.linkedin.test.ts

supabase/
└── migrations/
		└── 0002_brand_and_connections.sql
```

## Files to modify

- `web/app/(auth)/login/page.tsx` — add "Continue with Google"
- `web/app/(auth)/signup/page.tsx` — add "Continue with Google"
- `web/app/(app)/layout.tsx` — redirect first-time users into onboarding
- `web/lib/db/types.ts` — regenerate after migration
- `docs/DATA_MODEL.md` — add `brand_configs`, `prompt_versions`, `social_connections`
- `docs/API_CONTRACTS.md` — add LinkedIn OAuth contracts and onboarding save endpoint(s)
- `CLAUDE.md` — bump current phase to Phase 2 once acceptance criteria are complete

---

## Data model — exact SQL for this phase

Put this in `supabase/migrations/0002_brand_and_connections.sql`:

```sql
-- Phase 1: Brand config + prompt versioning + LinkedIn connection metadata

CREATE TABLE public.prompt_versions (
	id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	version_number  INTEGER NOT NULL,
	system_prompt   TEXT NOT NULL,
	created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT prompt_versions_workspace_version_unique UNIQUE (workspace_id, version_number)
);

ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_versions_member_select" ON public.prompt_versions
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "prompt_versions_member_insert" ON public.prompt_versions
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE TABLE public.brand_configs (
	workspace_id               UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
	brand_name                 TEXT NOT NULL,
	industry                   TEXT,
	website_url                TEXT,
	tone_tags                  TEXT[] NOT NULL DEFAULT '{}',
	custom_system_prompt       TEXT,
	current_prompt_version_id  UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
	created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_configs_member_select" ON public.brand_configs
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "brand_configs_member_insert" ON public.brand_configs
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "brand_configs_member_update" ON public.brand_configs
	FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE TABLE public.social_connections (
	id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id           UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	platform               TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
	platform_user_id       TEXT,
	platform_username      TEXT,
	-- Store only Vault secret references, never raw tokens
	access_token_vault_id  UUID,
	refresh_token_vault_id UUID,
	token_expires_at       TIMESTAMPTZ,
	needs_reauth           BOOLEAN NOT NULL DEFAULT false,
	connected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT social_connections_workspace_platform_unique UNIQUE (workspace_id, platform)
);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_connections_member_select" ON public.social_connections
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "social_connections_member_insert" ON public.social_connections
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "social_connections_member_update" ON public.social_connections
	FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_prompt_versions_workspace ON public.prompt_versions(workspace_id);
CREATE INDEX idx_social_connections_workspace ON public.social_connections(workspace_id);
CREATE INDEX idx_social_connections_expires ON public.social_connections(token_expires_at);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_configs_updated_at ON public.brand_configs;
CREATE TRIGGER trg_brand_configs_updated_at
	BEFORE UPDATE ON public.brand_configs
	FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_social_connections_updated_at ON public.social_connections;
CREATE TRIGGER trg_social_connections_updated_at
	BEFORE UPDATE ON public.social_connections
	FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

Then regenerate types:

```bash
pnpm --dir web gen:types
```

---

## API contract

Add these entries to `docs/API_CONTRACTS.md` in this phase.

### GET /api/oauth/linkedin/start

- Auth required: yes
- Query params: none
- Success response:
	- `302` redirect to LinkedIn authorization URL
- Error responses:
	- `401` if user is unauthenticated
	- `500` on configuration or adapter errors

### GET /api/oauth/linkedin/callback

- Auth required: yes (session and OAuth state must match)
- Query params:
	- `code: string`
	- `state: string`
- Success response:
	- `302` redirect to `/settings/connections?linkedin=connected`
- Side effects:
	- Exchange auth code for tokens using adapter
	- Encrypt/store tokens via Vault reference IDs in `social_connections`
	- Upsert workspace/platform connection row
- Error responses:
	- `400` invalid state or missing code
	- `401` unauthenticated session
	- `502` provider token exchange failure

### POST /api/brand/config

- Auth required: yes
- Request body:
	- `brand_name: string`
	- `industry?: string`
	- `website_url?: string`
	- `tone_tags: string[]`
	- `system_prompt: string`
- Success response:
	- `{ workspace_id, current_prompt_version_id, version_number }`
- Side effects:
	- Insert new row in `prompt_versions`
	- Upsert row in `brand_configs` pointing to latest `current_prompt_version_id`
- Error responses:
	- `400` validation error
	- `401` unauthenticated
	- `403` workspace membership violation

---

## Acceptance criteria

- [ ] "Continue with Google" is visible and functional on `/login` and `/signup` *(deferred — see BACKLOG.md)*
- [x] New users are redirected to `/onboarding` before dashboard access
- [x] Onboarding step 1 saves brand config and creates prompt version `1`
- [x] Editing prompt creates a new `prompt_versions` row (never updates historical rows)
- [x] LinkedIn connect flow completes through start + callback routes
- [x] LinkedIn tokens are stored via Vault references, not plaintext token columns
- [x] Settings pages show saved brand values and connection status
- [x] `0002_brand_and_connections.sql` applies cleanly via `db push`
- [x] `pnpm --dir web typecheck` passes
- [x] `pnpm --dir web test` passes
- [x] `web/lib/db/types.ts` regenerated and includes new Phase 1 tables

---

## Known pitfalls

- Do not scrape LinkedIn URLs (legal and platform risk decision)
- Do not overwrite brand prompts in place; always append to `prompt_versions`
- Ensure OAuth callback validates `state` and active user session
- Never log token values; store Vault references only
- Route handlers must not bypass db-layer module rules for Supabase access
- If using `--workdir` for Supabase CLI, ensure the root project is linked before `db push`

---

## When the phase is done

- [x] All acceptance criteria are checked (Google OAuth deferred to backlog)
- [x] `docs/DATA_MODEL.md` and `docs/API_CONTRACTS.md` are updated to match implementation
- [x] `CLAUDE.md` current phase is bumped to Phase 2
- [x] `docs/SESSION_NOTES.md` has a new top entry summarizing Phase 1 completion
- [x] Changes are committed with a conventional commit message
