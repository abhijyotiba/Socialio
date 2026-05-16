# Phase V2.2 — Multi-Persona Redesign (Round 2)

**Status:** Draft. Awaits user approval before any code is written.
**Branch:** `claude/review-multi-persona-arch-CwGpD`
**Prereq:** Round 1 surgical fixes shipped (commit `019444d`).

---

## 1. Why this redesign

Phase 2 of V2 added the persona/campaign data model and a working campaign-based generation path, but the rest of the codebase was retrofitted with `persona_id` columns rather than redesigned around persona context. The result is two parallel generation paths, scattered ownership checks, a workspace-scoped helper layer that silently returns the default persona's data, two competing connections pages, and no UI for the most important new surface (campaign approval).

The goal of Round 2 is to make **persona a first-class context object** that flows through every part of the system, and to delete the legacy workspace-scoped paths that contradict it. Once this lands, "multi-persona" is the only way the product works — there is no fallback path that silently hides the feature.

---

## 2. Target architecture

### 2.1 One generation pipeline

Delete `POST /api/posts` (generation). Every generation goes through `POST /api/campaigns` with `persona_ids: string[]`. Single-persona use is just `persona_ids: [defaultPersonaId]`. Benefits:

- One audit trail, one rate-limit path, one variant lifecycle.
- No orphaned `content_items` with NULL `persona_id`.
- No try/catch backfill blocks (current `web/app/api/posts/route.ts:123–147`).

### 2.2 `GenerationContext` carried through the pipeline

```ts
// web/lib/generation/context.ts (new)
export type GenerationContext = {
  workspace_id: string
  persona_id: string
  persona_name: string
  brand_system_prompt: string
  prompt_version_id: string  // snapshot — frozen at campaign creation
  platforms: Platform[]
  rate_limit_budget: Record<Platform, number>
}
```

The campaign route builds one of these per persona at the start. The worker HMAC-receives the whole object. Nothing downstream reconstructs persona context from `workspace_id`.

`prompt_version_id` is captured at this moment so brand updates between generation and approval don't silently desync.

### 2.3 Centralised persona guard

```ts
// web/lib/auth/persona-guard.ts (new)
export async function assertPersonaInWorkspace(
  personaId: string,
  workspaceId: string
): Promise<PersonaRow>  // throws on mismatch
```

Every route that accepts `persona_id` calls this. Replaces the inline checks currently scattered across `/api/campaigns/route.ts`, `/api/oauth/*/callback/route.ts`, and the persona detail/update routes.

### 2.4 One rate-limit policy module

```ts
// web/lib/policy/rate-limits.ts (new)
export async function canGenerateCampaign(workspaceId: string, fanOut: number)
export async function canPublish(personaId: string, platform: Platform)
export const PLATFORM_DAILY_LIMITS // re-exported, single source of truth
```

The `claim_due_variants` RPC reads the same limits via a small SQL `platform_limits` table (see §4.2). Eliminates the TS-vs-SQL drift currently flagged in the audit.

### 2.5 Persona-scoped helpers become the only public API

`web/lib/db/brand-configs.ts` and `web/lib/db/social-connections.ts` lose their workspace-scoped variants from the public surface:

- `getBrandConfig(workspaceId)` → move to `_legacy/` and mark `@deprecated`; remove all callers.
- `getSocialConnection(workspaceId, platform)` → same.
- `setVoiceProfile(workspaceId)` → replace with `setVoiceProfileForPersona(personaId)`.

Add an ESLint rule (`no-restricted-imports`) blocking imports of `_legacy/` outside a small allowlist (the cron sweep's pre-persona variant fallback, if we keep it; otherwise zero).

### 2.6 Persona in every structured log line

Wrap the existing logger so any code path with a persona in scope automatically attaches `persona_id` alongside `workspace_id` / `user_id`. Cheap, makes "Persona B never publishes" debuggable.

### 2.7 New UI surfaces

- **Campaign approval inbox** at `/campaigns` (list) and `/campaigns/[id]` (detail with per-persona cards, per-platform preview, approve/reject per persona + bulk action).
- **Per-persona brand settings** at `/settings/personas/[id]/brand`.
- **Connections page consolidation**: redirect `/settings/connections` → `/settings/personas/[defaultPersonaId]/connections`, or render a persona-picker. Delete the legacy version.
- **Persona switcher in the sidebar** (optional polish — gated behind the rest landing).

---

## 3. File-by-file plan

### 3.1 New files

| Path | Purpose |
|---|---|
| `web/lib/generation/context.ts` | `GenerationContext` type + builder |
| `web/lib/auth/persona-guard.ts` | `assertPersonaInWorkspace` |
| `web/lib/policy/rate-limits.ts` | `canGenerateCampaign`, `canPublish` |
| `web/lib/db/_legacy/brand-configs.ts` | Moved workspace-scoped helpers, `@deprecated` |
| `web/lib/db/_legacy/social-connections.ts` | Same |
| `web/app/(app)/campaigns/page.tsx` | Approval inbox list |
| `web/app/(app)/campaigns/[id]/page.tsx` | Approval detail |
| `web/app/(app)/campaigns/[id]/_components/PersonaApprovalCard.tsx` | Per-persona variant block |
| `web/app/(app)/settings/personas/[id]/brand/page.tsx` | Per-persona brand settings |
| `tests/api.campaigns.test.ts` | Multi-persona campaign happy path, partial-failure path |
| `tests/policy.rate-limits.test.ts` | Boundary tests |
| `tests/auth.persona-guard.test.ts` | Ownership mismatch coverage |

### 3.2 Files to modify

| Path | Change |
|---|---|
| `web/app/api/campaigns/route.ts` | Use `assertPersonaInWorkspace`; build `GenerationContext` per persona; call `canGenerateCampaign` |
| `web/app/api/posts/[id]/publish/route.ts` | Use `canPublish` + persona-scoped connection (already done in Round 1) |
| `web/app/api/cron/publish-due/route.ts` | Already persona-aware; just remove the workspace-default fallback once legacy posts are migrated |
| `web/app/api/oauth/linkedin/callback/route.ts` | Use `assertPersonaInWorkspace` instead of inline check |
| `web/app/api/oauth/x/callback/route.ts` | Same |
| `web/app/(app)/settings/brand/page.tsx` | Redirect to `/settings/personas/[defaultPersonaId]/brand` (single canonical surface) |
| `web/app/(app)/settings/connections/page.tsx` | Redirect or delete (see §2.7) |
| `web/app/(app)/chat/page.tsx` | After campaign creation, route user to `/campaigns/[id]` instead of polling inline |
| `web/lib/db/brand-configs.ts` | Remove workspace-scoped exports (moved to `_legacy/`) |
| `web/lib/db/social-connections.ts` | Same |
| `eslint.config.*` | Add `no-restricted-imports` rule for `_legacy/` |

### 3.3 Files to delete

| Path | Why |
|---|---|
| `web/app/api/posts/route.ts` (POST handler) | Replaced by `/api/campaigns`. Keep GET if it's used for listing. |
| Old onboarding/brand single-persona shortcuts (audit during work) | Subsumed by per-persona pages |

---

## 4. Data-model changes

Two small additions, no destructive changes.

### 4.1 Migration `0015_campaigns_error_and_prompt_snapshot.sql`

```sql
ALTER TABLE public.campaigns
  ADD COLUMN failure_reason TEXT,  -- human-readable, surfaced in approval inbox
  ADD COLUMN failure_code TEXT;    -- machine-readable, joins to error catalog

ALTER TABLE public.campaign_persona_variants
  ADD COLUMN prompt_version_id UUID REFERENCES public.prompt_versions(id);
-- Captures which brand voice generated this variant. Lets the UI surface
-- "your voice has changed since this was generated — regenerate?" prompts.

CREATE INDEX campaign_persona_variants_prompt_version_id_idx
  ON public.campaign_persona_variants(prompt_version_id);
```

Migration is additive only. No backfill needed; existing rows get NULL.

### 4.2 Migration `0016_platform_limits_table.sql`

```sql
CREATE TABLE public.platform_limits (
  platform TEXT PRIMARY KEY,
  daily_post_limit INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platform_limits (platform, daily_post_limit) VALUES
  ('linkedin', 20),
  ('x', 50);

-- Refactor claim_due_variants RPC to JOIN platform_limits instead of hardcoded CASE.
```

Single source of truth; TypeScript constants in `web/lib/constants/platforms.ts` are derived from this table at build time (or asserted equal via a CI test — simpler).

### 4.3 Optional later: drop workspace-default fallback in cron

Once the legacy `/api/posts` route is gone and any pre-persona `post_variants` have either been published or expired, we can drop the `getSocialConnection(workspaceId, platform)` fallback in the cron. Track separately in BACKLOG so we don't block on it.

---

## 5. Migration plan — from current to target without breakage

This is the order that minimises broken intermediate states.

### Step A — Foundation modules (no behaviour change)

1. Create `web/lib/auth/persona-guard.ts`, `web/lib/policy/rate-limits.ts`, `web/lib/generation/context.ts`. Tests included.
2. Move workspace-scoped helpers into `web/lib/db/_legacy/` but re-export from the original file path. No callers change yet.
3. Add the ESLint rule, configured as warning at first to surface every call site.

### Step B — Migrate callers behind the new modules

4. Update `/api/campaigns/route.ts` to use `GenerationContext` + guard + policy. Verify campaign flow end-to-end.
5. Update OAuth callbacks to use `assertPersonaInWorkspace`.
6. Update persona/brand routes to use persona-scoped helpers exclusively.

### Step C — UI surfaces

7. Build `/settings/personas/[id]/brand` page. Make `/settings/brand` a redirect.
8. Build `/campaigns` list and `/campaigns/[id]` detail with approval actions. Wire Realtime subscription for status changes.
9. Consolidate connections pages (redirect or persona-picker).

### Step D — Delete the legacy generation path

10. Remove `POST /api/posts` handler. Update the chat flow so single-persona use writes a campaign with `[defaultPersonaId]`.
11. Run migration `0015` (campaign error fields + variant prompt snapshot).
12. Run migration `0016` (platform_limits table). Refactor `claim_due_variants` to JOIN.

### Step E — Lock it down

13. Flip ESLint rule from warning to error on `_legacy/` imports outside allowlist.
14. Update phase doc with what shipped; append to `SESSION_NOTES.md`.

Each step is independently committable. Steps A–C are non-destructive and could ship behind a feature flag if desired (but probably overkill — branch + PR + manual smoke is enough).

---

## 6. Acceptance criteria

A reviewer should be able to verify all of these without reading the diff:

1. Creating a campaign with 2 personas produces 2 `content_items`, one per persona, each with the correct `prompt_version_id` snapshotted into its variants.
2. Publishing a variant for Persona B publishes via Persona B's tokens, full stop. There is no code path in which Persona A's tokens are silently used.
3. Updating the brand voice between generation and approval does **not** retroactively change the variant's prompt — but the UI shows a "voice has changed" hint.
4. `/campaigns` lists all in-flight and recent campaigns; clicking one shows per-persona variants with per-platform previews and approve/reject controls.
5. `/settings/personas/[id]/brand` exists and lets the user edit each persona's voice. `/settings/brand` redirects to the default persona's page.
6. Hitting the X daily limit on Persona A does **not** block Persona B from publishing X posts the same day.
7. A grep for `getSocialConnection(workspaceId` or `getBrandConfig(workspaceId` outside `_legacy/` returns zero hits.
8. `tsc --noEmit`, `eslint`, and `vitest` all pass on the branch.

---

## 7. Out of scope

These are real but belong in a later phase or in BACKLOG:

- **Persona switcher in the sidebar / global persona context.** Nice UX, not required for correctness. Add after the core lands.
- **Per-persona analytics filtering.** Column exists; UI does not. Tracked separately.
- **Edit-diff feedback loop for voice profiles.** Already deferred from Phase 7.
- **Worker-side persona awareness beyond the system prompt.** The worker takes a string today; nothing in this redesign needs it to know about persona structure.
- **Backfilling NULL `persona_id` on historical variants.** Leave them; the cron's workspace fallback handles them until they age out.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Deleting `/api/posts` breaks an unknown caller | Medium | Grep client-side code before deletion; keep a 410-Gone stub for a release if external tooling exists |
| Migration `0016` (platform_limits) is run before the RPC is updated | Low | Single migration file does both; CI runs migration on a test DB |
| Realtime subscription on `/campaigns/[id]` floods on bulk approval | Low | Debounce in the client; verify with a 10-persona campaign |
| ESLint rule flips from warning to error and CI is red | Low | Step E is explicitly after all callers are migrated and verified |
| User has in-flight variants generated under the old flow when we delete `/api/posts` | Medium | Keep cron's workspace-default fallback; verify all pending variants are persona-scoped before the delete commit |

---

## 9. Estimated effort

Rough sizing, assuming the foundation modules and migrations go cleanly:

- Step A (foundation): 0.5 day
- Step B (caller migration): 1 day
- Step C (UI surfaces): 2–3 days — the approval inbox is the biggest piece
- Step D (delete legacy path + migrations): 0.5 day
- Step E (lockdown + docs): 0.25 day
- **Total: ~4–5 days**

This is the part of the system that should have been built first. Once it lands, future persona-related work becomes cheap because the contracts are explicit.

---

## 10. Decisions (locked)

Resolved before code:

1. **`POST /api/posts` is deleted outright.** The chat UI is updated to call `/api/campaigns` directly. No thin-wrapper layer. Any external caller (none known) gets a 404.
2. **`/settings/connections` redirects to `/settings/personas/[defaultPersonaId]/connections`.** No persona-picker UI in this round.
3. **Approval is per-persona only.** Matches the `campaign_personas` grain. Per-platform approval is explicitly out of scope; if someone wants to publish LinkedIn but not X for a persona, they approve the persona and then manually cancel the X variant from the existing variant card.
4. **Migration `0016` (`platform_limits` table) lands this round.** Refactor `claim_due_variants` to JOIN it; `web/lib/constants/platforms.ts` becomes a thin re-export validated by a CI test.
5. **Persona switcher in sidebar is punted to a later UI polish round.** Not required for correctness.
