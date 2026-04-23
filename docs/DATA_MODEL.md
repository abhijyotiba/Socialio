# Data Model

This is the **single source of truth** for the database schema. Before writing any query, read the relevant section here. When adding or changing a table, update this file and the corresponding migration in `supabase/migrations/` in the same commit, then regenerate `web/lib/db/types.ts` via `supabase gen types typescript`.

Every table has Row Level Security enabled. Every table's policies are documented alongside the table. The convention: a user can access data in workspaces they belong to (via `public.workspace_members`) and nothing else.

---

## Contents

- [Phase 0 — Foundation](#phase-0--foundation)
  - `profiles`
  - `workspaces`
  - `workspace_members`
  - `user_workspace_ids()` helper
- [Phase 1 — Brand & Connections](#phase-1--brand--connections)
  - `brand_configs`
  - `prompt_versions`
  - `social_connections`
  - Vault helper functions
- [Phase 2 — Ingestion](#phase-2--ingestion)
  - `ingestion_jobs`
  - `media_assets`
- [Phase 3 — Generation](#phase-3--generation)
  - `content_items`
  - `post_variants`
- Phase 4 — Publishing *(to be added)*

---

## Phase 0 — Foundation

### `profiles`

One row per user. Extends `auth.users` with display fields we need that Supabase Auth doesn't store.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | Matches `auth.users.id`, cascade delete |
| `full_name` | `TEXT` | From signup metadata or email |
| `avatar_url` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | Default `now()` |

**RLS**

- `profiles_self_select` — a user can read their own profile.
- `profiles_self_update` — a user can update their own profile.

### `workspaces`

The top-level tenant boundary. In V1 each user owns exactly one workspace, auto-created on signup. In V2 a user can belong to multiple workspaces (team accounts).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `name` | `TEXT` NOT NULL | Default: `"{user}'s workspace"` |
| `created_at` | `TIMESTAMPTZ` | Default `now()` |

**RLS**

- `workspaces_member_select` — readable by any user in `workspace_members` for that workspace.
- No update/delete policies in Phase 0. Workspaces are created by the signup trigger and never updated directly yet.

### `workspace_members`

The join table between users and workspaces. This exists from Phase 0 (not V2) so that every downstream table can foreign-key to `workspace_id` instead of `user_id` — no migration needed when teams ship.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID` | FK `workspaces(id)`, cascade delete |
| `user_id` | `UUID` | FK `auth.users(id)`, cascade delete |
| `role` | `TEXT` NOT NULL | `'owner'` in V1. Future: `'admin'`, `'editor'`, `'viewer'`. |
| `joined_at` | `TIMESTAMPTZ` | Default `now()` |
| — | PRIMARY KEY (`workspace_id`, `user_id`) | |

**RLS**

- `members_self_select` — a user can see their own membership rows (used to list "my workspaces" on the client).
- No insert/update/delete policies in Phase 0. Membership rows are created only by the signup trigger.

### `user_workspace_ids()` helper

SQL function that returns the set of workspace IDs the current user belongs to. Used inside RLS policies on every downstream table to keep the policy expression short:

```sql
CREATE POLICY "posts_workspace_access" ON post_variants
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
```

### Signup trigger

On `INSERT INTO auth.users`, we automatically create:

1. A row in `profiles` with `id = NEW.id`
2. A row in `workspaces` named `"{display_name}'s workspace"`
3. A row in `workspace_members` linking them with `role = 'owner'`

The trigger function is `public.handle_new_user()`, marked `SECURITY DEFINER` so it can insert into tables the user's own role cannot write to.

---

---

## Phase 1 — Brand & Connections

Migration: `supabase/migrations/0002_brand_and_connections.sql`

### `brand_configs`

One row per workspace. Holds brand profile and a pointer to the currently active prompt version. The `custom_system_prompt` column is a convenience copy of the active prompt text; the source of truth for history is `prompt_versions`.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID` PK | FK `workspaces(id)`, cascade delete |
| `brand_name` | `TEXT` NOT NULL | Display name for the brand |
| `industry` | `TEXT` | Optional |
| `website_url` | `TEXT` | Optional |
| `tone_tags` | `TEXT[]` NOT NULL | Default `'{}'`. e.g. `{'professional','witty'}` |
| `custom_system_prompt` | `TEXT` | Copied from the latest `prompt_versions` row |
| `current_prompt_version_id` | `UUID` | FK `prompt_versions(id)`, SET NULL on delete |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| `updated_at` | `TIMESTAMPTZ` NOT NULL | Updated by trigger `trg_brand_configs_updated_at` |

**RLS**

- `brand_configs_member_select` — workspace members can read.
- `brand_configs_member_insert` — workspace members can insert.
- `brand_configs_member_update` — workspace members can update.

### `prompt_versions`

Append-only log of every system prompt used by a workspace. **Never UPDATE a row here.** When a user edits their prompt, INSERT a new row with `version_number + 1`.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `version_number` | `INTEGER` NOT NULL | Monotonically increasing per workspace |
| `system_prompt` | `TEXT` NOT NULL | The full system prompt text |
| `created_by` | `UUID` NOT NULL | FK `auth.users(id)`, RESTRICT on delete |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| — | UNIQUE (`workspace_id`, `version_number`) | |

**RLS**

- `prompt_versions_member_select` — workspace members can read.
- `prompt_versions_member_insert` — workspace members can insert.

**Index:** `idx_prompt_versions_workspace` on `workspace_id`.

### `social_connections`

One row per workspace × platform. Stores only Vault secret reference UUIDs — never raw token values.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `platform` | `TEXT` NOT NULL | CHECK `IN ('linkedin', 'x')` |
| `platform_user_id` | `TEXT` | Provider's numeric/string user ID |
| `platform_username` | `TEXT` | Human-readable display name |
| `access_token_vault_id` | `UUID` | Vault secret reference ID |
| `refresh_token_vault_id` | `UUID` | Vault secret reference ID (nullable) |
| `token_expires_at` | `TIMESTAMPTZ` | |
| `needs_reauth` | `BOOLEAN` NOT NULL | Default `false`. Set to `true` by token-expiry cron |
| `connected_at` | `TIMESTAMPTZ` NOT NULL | |
| `updated_at` | `TIMESTAMPTZ` NOT NULL | Updated by trigger |
| — | UNIQUE (`workspace_id`, `platform`) | |

**RLS**

- `social_connections_member_select` — workspace members can read.
- `social_connections_member_insert` — workspace members can insert.
- `social_connections_member_update` — workspace members can update.

**Indexes:** `idx_social_connections_workspace`, `idx_social_connections_expires`.

### Vault helper functions

Two `SECURITY DEFINER` SQL functions exposed to PostgREST. Both are `REVOKE`d from `PUBLIC` and `GRANT`ed to `service_role` only. Called from `lib/security/vault.ts` which is invoked only from OAuth callback routes and publish routes.

- `public.vault_create_secret(p_secret TEXT, p_name TEXT) RETURNS UUID` — stores a secret, returns the Vault UUID.
- `public.vault_read_secret(p_id UUID) RETURNS TEXT` — retrieves a decrypted secret by its Vault UUID.

---

## Phase 2 — Ingestion

Migration: `supabase/migrations/0003_ingestion.sql`

### `ingestion_jobs`

One row per ingestion request. Tracks the scraping pipeline from submission through to extracted content.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `source_type` | `TEXT` NOT NULL | CHECK `IN ('url', 'text', 'mcp')` |
| `source_url` | `TEXT` | Nullable — populated when `source_type = 'url'` |
| `source_text` | `TEXT` | Nullable — populated when `source_type = 'text'` |
| `extracted_title` | `TEXT` | Set by worker after successful scrape |
| `extracted_text` | `TEXT` | Set by worker after successful scrape |
| `stage` | `TEXT` NOT NULL | Default `'pending'`. CHECK `IN ('pending','scraping','uploading_media','analyzing','generating','storing','done','failed')` |
| `error` | `TEXT` | Error message if `stage = 'failed'` |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| `completed_at` | `TIMESTAMPTZ` | Set when `stage = 'done'` or `'failed'` |

**RLS**

- `ingestion_jobs_member_select` — workspace members can read.
- `ingestion_jobs_member_insert` — workspace members can insert.
- `ingestion_jobs_member_update` — workspace members can update.

**Indexes:** `idx_ingestion_jobs_workspace`, `idx_ingestion_jobs_stage`, `idx_ingestion_jobs_created`.

### `media_assets`

One row per media item (image or video) scraped and uploaded to Cloudinary during ingestion.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `ingestion_job_id` | `UUID` | FK `ingestion_jobs(id)`, SET NULL on delete |
| `cloudinary_url` | `TEXT` NOT NULL | Secure CDN URL |
| `cloudinary_id` | `TEXT` NOT NULL | Cloudinary `public_id` for transformations |
| `resource_type` | `TEXT` NOT NULL | CHECK `IN ('image', 'video')` |
| `format` | `TEXT` | e.g. `'jpg'`, `'mp4'` |
| `bytes` | `BIGINT` | File size |
| `width` | `INT` | Pixel width |
| `height` | `INT` | Pixel height |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |

**RLS**

- `media_assets_member_select` — workspace members can read.
- `media_assets_member_insert` — workspace members can insert.

**Indexes:** `idx_media_assets_job`, `idx_media_assets_workspace`.

---

## Phase 3 — Generation

Migration: `supabase/migrations/0004_generation.sql`

### `content_items`

One row per "generate" action. Links an ingestion job to its generated variants and records which prompt version produced them.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `ingestion_job_id` | `UUID` | FK `ingestion_jobs(id)`, SET NULL on delete |
| `prompt_version_id` | `UUID` | FK `prompt_versions(id)`, SET NULL on delete. Snapshot of which brand prompt was active |
| `summary` | `TEXT` | Pass-1 LLM output: condensed summary of the source content |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |

**RLS:** workspace members can select, insert, update.

**Indexes:** `idx_content_items_workspace`, `idx_content_items_job`, `idx_content_items_prompt_version`, `idx_content_items_created`.

### `post_variants`

One row per platform per content_item. Each row is a generated post draft with its own publishing state machine.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `content_item_id` | `UUID` NOT NULL | FK `content_items(id)`, cascade delete |
| `prompt_version_id` | `UUID` | FK `prompt_versions(id)`, SET NULL on delete. Snapshot of prompt used to generate this variant |
| `platform` | `TEXT` NOT NULL | CHECK `IN ('linkedin', 'x')` |
| `body` | `TEXT` NOT NULL | Generated post text |
| `status` | `TEXT` NOT NULL | Default `'draft'`. CHECK `IN ('draft','scheduled','publishing','published','failed','cancelled')` |
| `scheduled_at` | `TIMESTAMPTZ` | Populated when user schedules |
| `published_at` | `TIMESTAMPTZ` | Set on successful publish |
| `claimed_at` | `TIMESTAMPTZ` | Set by cron when it claims the row for publishing |
| `worker_id` | `TEXT` | Cron instance that claimed this row |
| `error` | `TEXT` | Last error message if status = 'failed' |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| `updated_at` | `TIMESTAMPTZ` NOT NULL | Maintained by trigger `trg_post_variants_updated_at` |

**RLS:** workspace members can select, insert, update.

**Indexes:** `idx_post_variants_workspace`, `idx_post_variants_content_item`, `idx_post_variants_prompt_version`, `idx_post_variants_status`, `idx_post_variants_scheduled` (partial, WHERE status = 'scheduled').

> **Phase 4 additions (migration 0007):** `platform_post_id TEXT`, `platform_post_url TEXT`, `error_code TEXT` — populated on publish success/failure.

---

## Phase 4 — Publishing

Migration: `supabase/migrations/0007_publish_attempts.sql`

### `publish_attempts`

Append-only audit log of every publish attempt. Also serves as the idempotency guard — a variant with a `success` row is never published again.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `post_variant_id` | `UUID` NOT NULL | FK `post_variants(id)`, cascade delete |
| `idempotency_key` | `TEXT` NOT NULL | Equals `post_variant_id`; sent to LinkedIn via `X-RestLi-Request-Id` |
| `attempt_number` | `INT` NOT NULL | Monotonically increasing per variant. `UNIQUE (idempotency_key, attempt_number)` |
| `status` | `TEXT` NOT NULL | Default `'attempting'`. CHECK `IN ('attempting', 'success', 'failed')` |
| `platform_post_id` | `TEXT` | Platform's post ID returned on success |
| `platform_post_url` | `TEXT` | Direct link to the published post |
| `error_code` | `TEXT` | Machine-readable: `TOKEN_EXPIRED`, `RATE_LIMITED`, `CONTENT_POLICY`, `SERVER_ERROR`, `UNKNOWN` |
| `error_detail` | `TEXT` | Raw error message for debugging |
| `attempted_at` | `TIMESTAMPTZ` NOT NULL | Default `now()` |
| `completed_at` | `TIMESTAMPTZ` | Set on success or final failure |

**RLS:** workspace members can select, insert, update.

**Indexes:** `idx_publish_attempts_variant`, `idx_publish_attempts_workspace`, `idx_publish_attempts_idempotency`.

---

## Conventions for future tables

When adding a new table in later phases, follow these rules unless you have a stated reason not to:

1. **Every table has a `workspace_id` column** (if the data is scoped to a workspace) foreign-keyed to `workspaces(id)` with `ON DELETE CASCADE`. Not `user_id`.
2. **Every table has an `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`** unless it's a pure join table like `workspace_members` where a composite PK makes more sense.
3. **Every table has `created_at` and `updated_at` where mutation is expected.** `updated_at` is maintained by a trigger, never by the application.
4. **Every table has RLS enabled in the same migration that creates it.** A CI check should fail the build if a migration adds a table without `ENABLE ROW LEVEL SECURITY`.
5. **Every policy uses `public.user_workspace_ids()`** rather than re-querying `workspace_members` inline. Faster to maintain and easier to audit.
6. **Soft deletes are opt-in.** Default to hard deletes with `ON DELETE CASCADE`. Add a `deleted_at` column only when we have a reason to recover deleted data.
7. **Enums are TEXT with a CHECK constraint**, not Postgres `ENUM` types. This makes adding a new value a simple `ALTER CHECK` instead of a type change. Example: `status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','publishing','published','failed','cancelled'))`.

---

## Migration hygiene

- Migrations live in `supabase/migrations/` and are numbered `0001_*.sql`, `0002_*.sql`, etc.
- A migration is **append-only after merge**. Never edit a migration that has run in any environment. If you need to change something, write a new migration.
- Before merging a migration to `main`, run it against a throwaway branch of the Supabase project (or a local Supabase via `supabase db reset`) to confirm it applies cleanly from zero.
- After any migration, regenerate the TypeScript types file and commit it in the same PR.

---

*Last updated: end of Phase 0 scaffolding. Phases 1+ will extend this document in place.*