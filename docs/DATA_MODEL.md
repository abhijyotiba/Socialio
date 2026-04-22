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
- Phase 1 — Brand & Connections *(to be added)*
- Phase 2 — Ingestion *(to be added)*
- Phase 3 — Generation *(to be added)*
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