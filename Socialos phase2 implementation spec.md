# SocialOS — Phase 2 Implementation Spec v3
## Multi-Persona Architecture — Corrected & Hardened

> **Document Type:** Agent Implementation Spec
> **Version:** 3.0 — incorporates all v2 audit fixes + second-pass review fixes (B1–B9, S1–S4)
> **Status:** Ready for implementation
> **Covers:** Phase 1 (Persona Foundation) + Phase 2 (Campaign Model)
>
> Agents must follow this document exactly.
> When this spec is silent on a decision, ask before assuming.
> Do not implement anything in `[FUTURE — CONSTRAIN ONLY]` sections.

---

## AUDIT FIXES INDEX

### v2 fixes (A1–A25) — carried forward, all resolved
| # | Issue | Severity | Section |
|---|-------|----------|---------|
| A1 | OAuth CSRF: `persona_id` must be inside signed state, not a separate cookie | Critical | §5 |
| A2 | `upsertBrandConfig` needs explicit `onConflict: 'persona_id'` | Critical | §4.3 |
| A3 | Migration assertions before NOT NULL enforcement | Critical | §3 |
| A4 | `claim_due_variants` must handle `persona_id IS NULL` explicitly | Critical | §3.11 |
| A5 | Campaign zombie state — timeout recovery path defined | Critical | §6.1 |
| A6 | `campaigns.status` missing `failed` state | Warning | §3.8 |
| A7 | `persona_rate_limits.reset_at` is timezone-unaware | Warning | §3.11 |
| A8 | `bot_sessions` unique constraint wrong — multi-workspace Telegram users | Warning | §3.13 |
| A9 | `getBrandConfig(workspaceId)` will return wrong row post-migration | Warning | §4.5 |
| A10 | No persona ownership validation before OAuth redirect | Warning | §5.1 |
| A11 | Old `/settings/connections` links break when `persona_id` required | Warning | §5.4 |
| A12 | Campaign generation cost explosion: 1 call per persona, not per platform | Warning | §6.1 |
| A13 | Persona soft cap undefined — add to constants + API route | Warning | §6.1 |
| A14 | `/api/posts` backward compat response shape must be explicit | Warning | §6.2 |
| A15 | Settings pages: extract shared form components, don't clone | Warning | §8 |
| A16 | `CampaignBatchCard` needs streaming/loading state with Realtime | Warning | §8.6 |
| A17 | Sidebar Settings href: always `/settings/personas`, no conditional | Info | §8.2 |
| A18 | Missing DB helper files in §12 file list | Info | §12 |
| A19 | `brand/config` and `voice-profile` routes missing from modified list | Info | §12 |
| A20 | `audit_events.actor_user_id` needs split for future external approvers | Info | §3.10 |
| A21 | `SUPPORTED_PLATFORMS` constant is JS-only — note limitations | Info | §10 |
| A22 | Parallel generation code sample was misleading — corrected | Info | §7.2 |
| A23 | No rate limiting on `POST /api/campaigns` itself | Info | §6.1 |
| A24 | RLS is a Phase 2 approximation — explicitly noted as incomplete | Info | §3.14 |
| A25 | `updated_at` triggers needed on new tables | Info | §3 |

### v3 fixes (B1–B9, S1–S4) — new in this version
| # | Issue | Severity | Section |
|---|-------|----------|---------|
| B1 | `campaign_personas.post_variant_id` is a single FK — can't track multiple variants (one per platform) per persona | Critical | §3.9, §4.2 |
| B2 | `POST /api/campaigns` creates a `content_item` per variant inside loop — should be one per persona | Critical | §6.1 |
| B3 | `generateForPersona` timeout with `Promise.race` doesn't abort the underlying `fetch` — connection leak | Critical | §7.2 |
| B4 | `claim_due_variants` RPC has hardcoded platform limits duplicating TS constants — two sources of truth | Warning | §3.11 |
| B5 | OAuth state `split(':')[1]` is fragile — use `indexOf` + `slice` | Warning | §5.1, §5.2 |
| B6 | `/api/posts` backward compat change is underspecified — internal behavior ambiguous | Warning | §6.2 |
| B7 | `CampaignBatchCard` streaming section has conflicting Option 1 SQL `ALTER TABLE` that looks like a migration step | Warning | §8.6 |
| B8 | `partially_approved` campaign status name is misleading (sounds like user-approval state, not generation state) | Warning | §3.8, §6.1 |
| B9 | `campaign_personas` missing `updated_at` column and trigger | Info | §3.9 |
| S1 | Campaign route should reject early if `extracted_text` is empty | Warning | §6.1 |
| S2 | `CampaignBatchCard` needs initial `getCampaignWithPersonas` fetch before Realtime subscription | Warning | §8.6 |
| S3 | `GET /api/campaigns` list has no UI — note intentional deferral explicitly | Info | §9 |
| S4 | `deletePersona` must check for active campaigns before deleting | Warning | §4.1 |

---

## 0. How to Read This Document

`[BUILD NOW]` = implement in this phase.
`[FUTURE — CONSTRAIN ONLY]` = do not build; listed only to prevent lock-in decisions.

---

## 1. Context: What Already Exists

The current codebase has a working publishing pipeline:
```
workspace → brand_configs (1 per workspace)
workspace → social_connections (1 per platform per workspace)
workspace → posting_schedules (per platform per workspace)
workspace → ingestion_jobs → content_items → post_variants → publish_attempts
```

Voice profiling (`VoiceSamplesPanel`, `workerAnalyzeVoice`, `render_system_prompt`) is complete.
`publish_attempts` with idempotency keys is solid — do not change it.
`workerGenerate` accepts `brand_system_prompt` string + platforms array — no worker interface changes.

**Nothing gets deleted. This is additive architecture only.**

---

## 2. The Core Architectural Change

**Current:** `workspace → brand voice → accounts → queue`
**New:** `workspace → personas → (each has: brand voice + accounts + queue)`
**Campaign:** one source content item → distributed across selected personas simultaneously

**Single most important constraint:**
Every table currently scoped to `workspace_id` that relates to content, accounts,
or scheduling MUST also get `persona_id`.

Tables gaining `persona_id`: `brand_configs`, `social_connections`, `posting_schedules`, `post_variants`

Tables remaining workspace-scoped only (do NOT add persona_id):
`workspaces`, `workspace_members`, `ingestion_jobs`, `media_assets`, `publish_attempts`, `prompt_versions`

---

## 3. Database Schema [BUILD NOW]

### 3.0 Constants file — define before writing any SQL

Create `web/lib/constants/platforms.ts`:

```typescript
export const SUPPORTED_PLATFORMS = ['linkedin', 'x'] as const
export type Platform = typeof SUPPORTED_PLATFORMS[number]

export const PERSONA_SOFT_CAP = 10           // max personas per workspace (pricing axis)
export const PERSONA_HARD_CAP = 50           // absolute DB limit, enforced in API

// Platform daily post limits (conservative — platforms may allow more)
// IMPORTANT [B4]: These values are duplicated in the claim_due_variants SQL RPC.
// When changing these limits, you MUST also update the CASE statement in that RPC.
// See §3.11 for the SQL. A comment in the RPC points back here.
export const PLATFORM_DAILY_LIMITS: Record<Platform, number> = {
  linkedin: 20,
  x: 50,
}

// Platform character limits
export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  linkedin: 3000,
  x: 280,
}
```

**Note [A21]:** This constant is TypeScript-only. Platform names are also present in:
- Python worker `_PLATFORM_HINTS` dict (keep in sync manually until Phase 4 connector refactor)
- Python `Literal["linkedin", "x"]` type annotations (keep in sync manually)
- Zod schemas in API routes (update to reference this constant via `z.enum(SUPPORTED_PLATFORMS)`)

The Phase 4 connector architecture is the real fix. This constant reduces JS-layer duplication now.

### 3.1 `updated_at` trigger [A25]

Before creating new tables, ensure this trigger function exists (create if not present):

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Apply to every new table that has `updated_at`. Shown at each table definition below.

### 3.2 New Table: `personas`

```sql
CREATE TABLE personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  slug          TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),
  avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(workspace_id, slug)
);

-- Enforce one default persona per workspace at DB level
CREATE UNIQUE INDEX personas_workspace_default_idx
  ON personas(workspace_id) WHERE is_default = true;

-- Soft cap: 50 personas max per workspace (hard limit; pricing enforced in API at 10)
-- This cannot be enforced with a simple constraint; enforced in API route (see §6.1)

CREATE TRIGGER personas_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Slug generation [A3 related]:** The application generates slugs, not the DB.
The `createPersona` helper must handle the `UNIQUE(workspace_id, slug)` conflict
by retrying with `-2`, `-3` suffix. Use a loop with max 10 attempts, then throw.
This is safe because slug conflicts are rare and retry is fast. No DB function needed.

### 3.3 Migration Step 1: Create default personas

**This must run as a separate statement BEFORE any ALTER TABLE in steps 3.4–3.7.**
In a single migration file, use explicit transaction savepoints:

```sql
-- STEP 1: Create default personas for all existing workspaces
INSERT INTO personas (workspace_id, name, slug, is_default, avatar_color)
SELECT
  id AS workspace_id,
  COALESCE(NULLIF(TRIM(name), ''), 'Main Account') AS name,
  'main-account' AS slug,
  true AS is_default,
  '#6366f1' AS avatar_color
FROM workspaces
ON CONFLICT DO NOTHING;

-- ASSERTION: Every workspace must have a default persona before proceeding
DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM workspaces w
  WHERE NOT EXISTS (
    SELECT 1 FROM personas p WHERE p.workspace_id = w.id AND p.is_default = true
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % workspaces have no default persona', missing_count;
  END IF;
END $$;
```

### 3.4 Alter `brand_configs`

```sql
-- STEP 2: Add persona_id column (nullable first)
ALTER TABLE brand_configs ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;

-- STEP 3: Populate persona_id for all existing rows
UPDATE brand_configs bc
SET persona_id = p.id
FROM personas p
WHERE p.workspace_id = bc.workspace_id
  AND p.is_default = true;

-- ASSERTION: No nulls remain [A3]
DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM brand_configs WHERE persona_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % brand_configs rows have no persona_id', null_count;
  END IF;
END $$;

-- STEP 4: Enforce NOT NULL now that we've verified
ALTER TABLE brand_configs ALTER COLUMN persona_id SET NOT NULL;

-- STEP 5: Update unique constraint
ALTER TABLE brand_configs DROP CONSTRAINT IF EXISTS brand_configs_workspace_id_key;
ALTER TABLE brand_configs ADD CONSTRAINT brand_configs_persona_id_key UNIQUE (persona_id);
```

### 3.5 Alter `social_connections`

```sql
ALTER TABLE social_connections ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;

UPDATE social_connections sc
SET persona_id = p.id
FROM personas p
WHERE p.workspace_id = sc.workspace_id AND p.is_default = true;

DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM social_connections WHERE persona_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % social_connections rows have no persona_id', null_count;
  END IF;
END $$;

ALTER TABLE social_connections ALTER COLUMN persona_id SET NOT NULL;

-- Update unique constraint: was (workspace_id, platform), now (persona_id, platform)
-- One connection per platform per persona. Multiple personas can each have their own accounts.
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_workspace_id_platform_key;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_persona_platform_key
  UNIQUE (persona_id, platform);
```

### 3.6 Alter `posting_schedules`

```sql
ALTER TABLE posting_schedules ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;

UPDATE posting_schedules ps
SET persona_id = p.id
FROM personas p
WHERE p.workspace_id = ps.workspace_id AND p.is_default = true;

DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM posting_schedules WHERE persona_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % posting_schedules rows have no persona_id', null_count;
  END IF;
END $$;

ALTER TABLE posting_schedules ALTER COLUMN persona_id SET NOT NULL;
```

### 3.7 Alter `post_variants`

```sql
-- persona_id is intentionally nullable — old posts predate the persona system
ALTER TABLE post_variants ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;

-- Best-effort backfill for existing variants via their content_item → workspace → default persona
UPDATE post_variants pv
SET persona_id = p.id
FROM content_items ci
JOIN personas p ON p.workspace_id = ci.workspace_id AND p.is_default = true
WHERE pv.content_item_id = ci.id
  AND pv.persona_id IS NULL;

-- NOTE: Do NOT enforce NOT NULL on post_variants.persona_id
-- Old posts legitimately have NULL persona_id
-- The cron job handles this explicitly (see §3.11)
```

### 3.8 New Table: `campaigns`

**[B8] Campaign status rename:** `partially_approved` has been renamed to `generation_partial`.
The name `partially_approved` sounded like user approval state. `generation_partial` correctly
describes the generation outcome (some personas generated successfully, some failed).

```sql
CREATE TABLE campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ingestion_job_id  UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  title             TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'generating',
      'pending_approval',
      'generation_partial',  -- [B8] renamed from 'partially_approved': some personas generated, some failed
      'approved',
      'scheduled',
      'completed',
      'failed'               -- [A6] all personas failed generation
    )),
  generation_started_at TIMESTAMPTZ,   -- set when status → generating; used for zombie detection
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_workspace_status_idx ON campaigns(workspace_id, status);
CREATE INDEX campaigns_zombie_detection_idx ON campaigns(status, generation_started_at)
  WHERE status = 'generating';   -- used by cleanup cron

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Campaign status lifecycle:**
```
draft → generating          (on POST /api/campaigns, before worker calls fire)
generating → pending_approval    (all personas generated successfully)
generating → generation_partial  (some personas failed generation, some succeeded)
generating → failed              (all personas failed generation)
pending_approval / generation_partial → approved  (all pending personas approved by user)
approved → scheduled             (all approved variants have scheduled_at set)
scheduled → completed            (all variants published — updated by cron publish job)
```

**Zombie campaign cleanup [A5]:**
Add to `web/app/api/cron/publish-due/route.ts` (already runs every minute):
```typescript
// Reset campaigns stuck in 'generating' for more than 3 minutes
const { data: zombieCampaigns } = await admin
  .from('campaigns')
  .update({ status: 'failed' })
  .eq('status', 'generating')
  .lt('generation_started_at', new Date(Date.now() - 3 * 60 * 1000).toISOString())
  .select('id')

// For any zombie campaign, also mark its pending campaign_personas as 'rejected'
if (zombieCampaigns?.length) {
  await admin
    .from('campaign_personas')
    .update({ approval_status: 'rejected' })
    .eq('approval_status', 'pending')
    .in('campaign_id', zombieCampaigns.map(c => c.id))
}
```

### 3.9 New Table: `campaign_personas` + `campaign_persona_variants` [B1]

**[B1] Problem with a single `post_variant_id` FK:** A persona with both LinkedIn and X connected
generates 2 variants per campaign (one per platform). A single FK can only track one — the second
variant would be orphaned from the campaign approval flow.

**Solution:** Remove `post_variant_id` from `campaign_personas`. Add a separate
`campaign_persona_variants` join table that links each `campaign_personas` row to all its
generated variants. The approval flow queries this table to find all variants to schedule.

```sql
CREATE TABLE campaign_personas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  generation_error TEXT,     -- set when worker call fails for this persona; null on success
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),  -- [B9]

  UNIQUE(campaign_id, persona_id)
);

CREATE INDEX campaign_personas_campaign_idx ON campaign_personas(campaign_id);

CREATE TRIGGER campaign_personas_updated_at  -- [B9]
  BEFORE UPDATE ON campaign_personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- [B1] One row per generated variant per campaign_persona (handles multi-platform personas)
CREATE TABLE campaign_persona_variants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_persona_id  UUID NOT NULL REFERENCES campaign_personas(id) ON DELETE CASCADE,
  post_variant_id      UUID NOT NULL REFERENCES post_variants(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL,  -- denormalized from post_variants for query convenience
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(campaign_persona_id, post_variant_id)
);

CREATE INDEX campaign_persona_variants_campaign_persona_idx
  ON campaign_persona_variants(campaign_persona_id);
```

### 3.10 New Table: `audit_events`

```sql
-- [A20] Split actor identity: user actor vs external actor (for future client portal)
CREATE TABLE audit_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  persona_id       UUID REFERENCES personas(id) ON DELETE SET NULL,
  actor_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null for system/cron
  actor_external_id TEXT,           -- for future Phase 6 client portal approvers (no auth.users row)
  event_type       TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        UUID NOT NULL,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_workspace_created_idx ON audit_events(workspace_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id);
```

Phase 2 event types to insert (do not insert others yet):
- `post.published`, `post.failed`, `campaign.created`, `campaign_persona.approved`

### 3.11 New Table: `persona_rate_limits`

```sql
CREATE TABLE persona_rate_limits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  posts_today      INTEGER NOT NULL DEFAULT 0,
  last_post_at     TIMESTAMPTZ,
  -- [A7] day_reset_at is the UTC date the count is valid for (not a rolling window)
  -- The check is: if day_reset_at < CURRENT_DATE, reset posts_today to 0
  day_reset_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(persona_id, platform)
);

CREATE TRIGGER persona_rate_limits_updated_at
  BEFORE UPDATE ON persona_rate_limits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Rate limit reset strategy [A7]:**
`posts_today` counts posts on `day_reset_at` (UTC date).
The check is: `IF day_reset_at < CURRENT_DATE THEN posts_today = 0; day_reset_at = CURRENT_DATE`.
This happens in the application layer, not a cron, making it timezone-deterministic.

**Updated `claim_due_variants` RPC [A4, B4]:**
The existing RPC must be updated to include the rate limit check below.

**[B4] Duplicate limits warning:** The CASE values below (linkedin: 20, x: 50) duplicate
`PLATFORM_DAILY_LIMITS` in `web/lib/constants/platforms.ts`. There is no automated sync.
When changing platform limits, update BOTH the TS constant AND this SQL.
A comment in the TS constant also points here (see §3.0).

```sql
-- Within the claim_due_variants RPC, add this condition to the WHERE clause:
-- Variants with persona_id IS NULL bypass rate limiting (old posts, pre-persona)
-- Variants with persona_id must pass rate limit check
AND (
  pv.persona_id IS NULL  -- old posts: no rate limit applied [A4]
  OR NOT EXISTS (
    SELECT 1 FROM persona_rate_limits prl
    WHERE prl.persona_id = pv.persona_id
      AND prl.platform = pv.platform
      AND prl.day_reset_at = CURRENT_DATE
      -- [B4] KEEP IN SYNC WITH PLATFORM_DAILY_LIMITS in web/lib/constants/platforms.ts
      AND prl.posts_today >= (
        CASE pv.platform
          WHEN 'linkedin' THEN 20
          WHEN 'x' THEN 50
          ELSE 999
        END
      )
  )
)
```

### 3.12 New Table: `bot_sessions`

```sql
-- [A8] UNIQUE constraint includes workspace_id — one session per (user, workspace, channel)
CREATE TABLE bot_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  external_user_id    TEXT NOT NULL,
  current_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  state               TEXT NOT NULL DEFAULT 'idle',
  state_data          JSONB DEFAULT '{}',
  last_active_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- [A8] A Telegram user managing 3 client workspaces gets 3 sessions (one per workspace)
  -- The bot's /start command or workspace-linking flow sets which workspace is active
  UNIQUE(channel, external_user_id, workspace_id)
);
```

Do not build any bot functionality. Table only.

### 3.13 RLS Policies

```sql
-- personas
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY personas_workspace_isolation ON personas
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_workspace_isolation ON campaigns
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- campaign_personas
ALTER TABLE campaign_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_personas_workspace_isolation ON campaign_personas
  USING (campaign_id IN (
    SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())
  ));

-- campaign_persona_variants [B1 new table]
ALTER TABLE campaign_persona_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_persona_variants_workspace_isolation ON campaign_persona_variants
  USING (campaign_persona_id IN (
    SELECT cp.id FROM campaign_personas cp
    JOIN campaigns c ON c.id = cp.campaign_id
    WHERE c.workspace_id IN (SELECT user_workspace_ids())
  ));

-- audit_events
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_workspace_isolation ON audit_events
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- persona_rate_limits
ALTER TABLE persona_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY persona_rate_limits_workspace_isolation ON persona_rate_limits
  USING (persona_id IN (
    SELECT id FROM personas WHERE workspace_id IN (SELECT user_workspace_ids())
  ));

-- bot_sessions
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_sessions_workspace_isolation ON bot_sessions
  USING (workspace_id IN (SELECT user_workspace_ids()));
```

**[A24] RLS is intentionally incomplete for Phase 2.**
Current policies grant all workspace members access to all personas' data within a workspace.
When team member persona ownership lands (Phase 5+), every policy on `brand_configs`,
`social_connections`, `post_variants`, and `posting_schedules` must be rewritten to
filter by `persona_id` based on which personas the authenticated user owns.
Implementors must NOT treat these policies as final. They are a Phase 2 approximation.

### 3.14 Regenerate types

```bash
cd web && pnpm gen:types
```

---

## 4. DB Helper Functions [BUILD NOW]

### 4.1 New file: `web/lib/db/personas.ts`

```typescript
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'
import { PERSONA_HARD_CAP } from '@/lib/constants/platforms'

type PersonaRow = Database['public']['Tables']['personas']['Row']

// Generate a URL-safe slug from a name, with collision retry
export async function generatePersonaSlug(
  workspaceId: string,
  name: string
): Promise<string> {
  const supabase = await createClient()
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  for (let i = 0; i <= 10; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const { data } = await supabase
      .from('personas')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now()}`
}

export async function getPersonasForWorkspace(workspaceId: string): Promise<PersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('personas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getPersona(id: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('personas').select('*').eq('id', id).single()
  return data
}

export async function getDefaultPersona(workspaceId: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('personas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .single()
  return data
}

export async function createPersona(
  workspaceId: string,
  name: string,
  avatarColor?: string
): Promise<PersonaRow> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('personas')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  if ((count ?? 0) >= PERSONA_HARD_CAP) {
    throw new Error(`Workspace has reached the maximum of ${PERSONA_HARD_CAP} personas`)
  }

  const slug = await generatePersonaSlug(workspaceId, name)
  const { data, error } = await supabase
    .from('personas')
    .insert({ workspace_id: workspaceId, name, slug, avatar_color: avatarColor ?? '#6366f1' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePersona(
  id: string,
  patch: Pick<Partial<PersonaRow>, 'name' | 'avatar_color'>
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('personas').update(patch).eq('id', id)
  if (error) throw error
}

// [S4] Cannot delete a persona that has active campaigns (pending or generating).
// Deleting such a persona leaves those campaigns in a broken state.
export async function deletePersona(id: string): Promise<void> {
  const supabase = await createClient()

  const { data: persona } = await supabase
    .from('personas')
    .select('is_default')
    .eq('id', id)
    .single()
  if (persona?.is_default) throw new Error('Cannot delete the default persona')

  // Check for active campaigns linked to this persona
  const { count: activeCampaignCount } = await supabase
    .from('campaign_personas')
    .select('id', { count: 'exact', head: true })
    .eq('persona_id', id)
    .eq('approval_status', 'pending')
  if ((activeCampaignCount ?? 0) > 0) {
    throw new Error('Cannot delete a persona with pending campaigns. Reject or complete them first.')
  }

  const { error } = await supabase.from('personas').delete().eq('id', id)
  if (error) throw error
}
```

### 4.2 New file: `web/lib/db/campaigns.ts` [B1 updated]

```typescript
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignInsert = Database['public']['Tables']['campaigns']['Insert']
type CampaignPersonaRow = Database['public']['Tables']['campaign_personas']['Row']
type CampaignPersonaVariantRow = Database['public']['Tables']['campaign_persona_variants']['Row']

// [B1] Each campaign_persona now has zero or more campaign_persona_variants (one per platform)
export type CampaignWithPersonas = CampaignRow & {
  campaign_personas: Array<CampaignPersonaRow & {
    persona: { id: string; name: string; avatar_color: string; slug: string }
    // [B1] variants is an array — one per platform (e.g., LinkedIn + X = 2 entries)
    variants: Array<{
      id: string          // campaign_persona_variants.id
      platform: string
      post_variant_id: string
      body: string
      status: string
    }>
  }>
}

export async function createCampaign(values: CampaignInsert): Promise<CampaignRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaigns')
    .insert(values)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCampaign(
  id: string,
  patch: Partial<CampaignRow>
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('campaigns').update(patch).eq('id', id)
  if (error) throw error
}

export async function getCampaignWithPersonas(id: string): Promise<CampaignWithPersonas | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select(`
      *,
      campaign_personas (
        *,
        persona:personas ( id, name, avatar_color, slug ),
        variants:campaign_persona_variants (
          id,
          platform,
          post_variant_id,
          post_variants ( body, status )
        )
      )
    `)
    .eq('id', id)
    .single()
  return data as CampaignWithPersonas | null
}

export async function createCampaignPersonas(
  campaignId: string,
  personaIds: string[]
): Promise<CampaignPersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaign_personas')
    .insert(personaIds.map(personaId => ({ campaign_id: campaignId, persona_id: personaId })))
    .select()
  if (error) throw error
  return data ?? []
}

// [B1] Link generated variants to a campaign_persona — one call per persona, passing all variants
export async function createCampaignPersonaVariants(
  campaignPersonaId: string,
  variants: Array<{ post_variant_id: string; platform: string }>
): Promise<CampaignPersonaVariantRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaign_persona_variants')
    .insert(variants.map(v => ({
      campaign_persona_id: campaignPersonaId,
      post_variant_id: v.post_variant_id,
      platform: v.platform,
    })))
    .select()
  if (error) throw error
  return data ?? []
}

export async function updateCampaignPersonaApproval(
  campaignPersonaId: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaign_personas')
    .update({
      approval_status: status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', campaignPersonaId)
  if (error) throw error
}

// Get all post_variant IDs for an approved campaign_persona (for scheduling)
export async function getVariantsForCampaignPersona(
  campaignPersonaId: string
): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaign_persona_variants')
    .select('post_variant_id')
    .eq('campaign_persona_id', campaignPersonaId)
  return (data ?? []).map(row => row.post_variant_id)
}
```

### 4.3 New file: `web/lib/db/audit-events.ts` [A18]

```typescript
import { createClient } from '@/lib/supabase/server'

type AuditEventInsert = {
  workspace_id: string
  persona_id?: string | null
  actor_user_id?: string | null
  event_type: string
  entity_type: string
  entity_id: string
  metadata?: Record<string, unknown>
}

// Fire-and-forget — never throw on audit failures
export async function insertAuditEvent(event: AuditEventInsert): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('audit_events').insert(event)
  } catch {
    // Audit must never break the main flow
  }
}
```

### 4.4 New file: `web/lib/db/persona-rate-limits.ts` [A18]

```typescript
import { createClient } from '@/lib/supabase/server'
import { PLATFORM_DAILY_LIMITS, type Platform } from '@/lib/constants/platforms'

// Check and increment rate limit for a persona+platform.
// Returns true if the post is allowed, false if rate limit exceeded.
export async function checkAndIncrementRateLimit(
  personaId: string,
  platform: Platform
): Promise<boolean> {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]  // YYYY-MM-DD UTC
  const dailyLimit = PLATFORM_DAILY_LIMITS[platform]

  const { data: existing } = await supabase
    .from('persona_rate_limits')
    .select('*')
    .eq('persona_id', personaId)
    .eq('platform', platform)
    .maybeSingle()

  if (!existing) {
    await supabase.from('persona_rate_limits').insert({
      persona_id: personaId,
      platform,
      posts_today: 1,
      last_post_at: new Date().toISOString(),
      day_reset_at: today,
    })
    return true
  }

  const count = existing.day_reset_at < today ? 0 : existing.posts_today
  if (count >= dailyLimit) return false

  await supabase
    .from('persona_rate_limits')
    .update({ posts_today: count + 1, last_post_at: new Date().toISOString(), day_reset_at: today })
    .eq('persona_id', personaId)
    .eq('platform', platform)

  return true
}
```

### 4.5 Update `web/lib/db/brand-configs.ts` [A9]

```typescript
// [A9] getBrandConfig(workspaceId) now explicitly queries via default persona to avoid
// returning the wrong row in a multi-persona workspace

export async function getBrandConfig(workspaceId: string): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs')
    .select('*, personas!inner(workspace_id, is_default)')
    .eq('personas.workspace_id', workspaceId)
    .eq('personas.is_default', true)
    .single()
  return data
}

// New: persona-scoped (prefer this in all new code paths)
export async function getBrandConfigForPersona(personaId: string): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs')
    .select('*')
    .eq('persona_id', personaId)
    .single()
  return data
}

// [A2] Fix upsert: explicit onConflict target
export async function upsertBrandConfig(values: BrandConfigInsert): Promise<BrandConfigRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('brand_configs')
    .upsert(values, { onConflict: 'persona_id' })
    .select()
    .single()
  if (error) throw error
  return data
}
```

### 4.6 Update `web/lib/db/social-connections.ts`

```typescript
// Keep existing function for backward compat — routes through default persona
export async function getSocialConnection(
  workspaceId: string,
  platform: string
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*, personas!inner(workspace_id, is_default)')
    .eq('personas.workspace_id', workspaceId)
    .eq('personas.is_default', true)
    .eq('platform', platform)
    .maybeSingle()
  return data
}

// New: persona-scoped (prefer this in all new code paths)
export async function getSocialConnectionForPersona(
  personaId: string,
  platform: string
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*')
    .eq('persona_id', personaId)
    .eq('platform', platform)
    .maybeSingle()
  return data
}

export async function getConnectionsForPersona(
  personaId: string
): Promise<SocialConnectionRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*')
    .eq('persona_id', personaId)
  return data ?? []
}
```

---

## 5. OAuth Flow Changes [BUILD NOW]

### 5.1 LinkedIn start route — embed persona_id in state [A1, A10, B5]

```typescript
// web/app/api/oauth/linkedin/start/route.ts
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  // [A11, §5.4] persona_id is optional — backward compat falls back to default persona
  let personaId = new URL(request.url).searchParams.get('persona_id')
  if (!personaId) {
    const defaultPersona = await getDefaultPersona(workspace.workspace_id)
    if (!defaultPersona) return NextResponse.json({ error: 'No default persona' }, { status: 400 })
    personaId = defaultPersona.id
  }

  // [A10] Validate persona belongs to this workspace
  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
  }

  // [A1] Embed persona_id inside the state token — do NOT use a separate cookie
  // Format: "<32-char hex>:<persona-uuid>"
  const randomPart = randomBytes(16).toString('hex')
  const state = `${randomPart}:${personaId}`

  const cookieStore = await cookies()
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return NextResponse.redirect(buildAuthorizationUrl(state))
}
```

### 5.2 LinkedIn callback route — extract persona_id from state [A1, B5]

```typescript
// web/app/api/oauth/linkedin/callback/route.ts
export async function GET(request: NextRequest) {
  // ...existing auth check...

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  const cookieStore = await cookies()
  const savedState = cookieStore.get('linkedin_oauth_state')?.value

  if (!savedState || savedState !== state || !code) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // [B5] Use indexOf + slice instead of split(':')[1] to be safe against any
  // future format changes. UUIDs don't contain colons, but this is more explicit.
  const colonIdx = savedState.indexOf(':')
  if (colonIdx === -1) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }
  const personaId = savedState.slice(colonIdx + 1)
  if (!personaId) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }

  // Verify persona ownership (defense in depth — start route already checked)
  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona mismatch' }, { status: 403 })
  }

  cookieStore.delete('linkedin_oauth_state')

  // ...token exchange...

  await upsertSocialConnection({
    workspace_id: workspace.workspace_id,
    persona_id: personaId,
    platform: 'linkedin',
    // ...other fields...
  }, admin)

  return NextResponse.redirect(
    new URL(`/settings/personas/${personaId}/connections?linkedin=connected`, request.url)
  )
}
```

### 5.3 X OAuth — same pattern as LinkedIn [A1, A10, B5]

Apply identical changes to `x/start/route.ts` and `x/callback/route.ts`.
State format: `${randomPart}:${personaId}` (same as LinkedIn).
Extract persona_id using `indexOf(':')` + `slice` — not `split(':')[1]`.
No separate `x_oauth_persona_id` cookie.

### 5.4 Backward compat: old `/settings/connections` page [A11]

The existing `/settings/connections` page links to `/api/oauth/linkedin/start` with no
`persona_id`. The start route (§5.1) handles this gracefully: if `persona_id` is absent,
it falls back to the workspace's default persona. No change needed to the connections page itself.

Do NOT update `/settings/connections` in this phase. It continues to work unchanged.

---

## 6. API Routes [BUILD NOW]

### 6.1 New route: `POST /api/campaigns` [B1, B2, B3, S1 updated]

```typescript
// web/app/api/campaigns/route.ts

const bodySchema = z.object({
  ingestion_job_id: z.string().uuid(),
  persona_ids: z.array(z.string().uuid()).min(1).max(PERSONA_SOFT_CAP),
  platforms: z.array(z.enum(SUPPORTED_PLATFORMS)).optional(),
})

export async function POST(request: Request) {
  // ...auth, workspace check...

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // [A23] Rate limit: 2 campaigns per minute per workspace
  const perMinute = await countRecentCampaigns(workspaceId, 60)
  if (perMinute >= 2) return NextResponse.json({ error: 'Rate limit: 2 campaigns per minute' }, { status: 429 })

  const { ingestion_job_id, persona_ids, platforms: requestedPlatforms } = parsed.data

  // Validate ingestion job
  const job = await getIngestionJob(ingestion_job_id)
  if (!job || job.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.stage !== 'done') {
    return NextResponse.json({ error: 'Ingestion not ready' }, { status: 409 })
  }

  // [S1] Reject early if there is no content to generate from
  if (!job.extracted_text?.trim()) {
    return NextResponse.json({ error: 'Ingestion job has no extracted text' }, { status: 409 })
  }

  // Validate all personas belong to this workspace
  const personas = await Promise.all(persona_ids.map(id => getPersona(id)))
  const invalidPersona = personas.find(p => !p || p.workspace_id !== workspaceId)
  if (invalidPersona !== undefined) {
    return NextResponse.json({ error: 'Invalid persona' }, { status: 403 })
  }

  // Fetch brand configs and connections for each persona in parallel
  const [brandConfigs, connectionsByPersona] = await Promise.all([
    Promise.all(persona_ids.map(id => getBrandConfigForPersona(id))),
    Promise.all(persona_ids.map(id => getConnectionsForPersona(id))),
  ])

  // Check each persona has a voice profile before creating the campaign
  const missingBrand = persona_ids.find((_, i) => !brandConfigs[i]?.custom_system_prompt)
  if (missingBrand) {
    return NextResponse.json({ error: 'One or more personas have no voice profile set' }, { status: 409 })
  }

  // Create campaign and campaign_persona rows
  const campaign = await createCampaign({
    workspace_id: workspaceId,
    ingestion_job_id,
    title: job.extracted_title ?? undefined,
    status: 'generating',
    generation_started_at: new Date().toISOString(),
  })
  const campaignPersonaRows = await createCampaignPersonas(campaign.id, persona_ids)

  // Build a map from persona_id → campaign_persona row for later use
  const campaignPersonaByPersonaId = Object.fromEntries(
    campaignPersonaRows.map(row => [row.persona_id, row])
  )

  // Generate variants for all personas in parallel [A12, B3]
  const generationResults = await Promise.allSettled(
    persona_ids.map((personaId, idx) =>
      generateForPersona({
        personaId,
        brand: brandConfigs[idx]!,
        connections: connectionsByPersona[idx] ?? [],
        requestedPlatforms,
        job,
        workspaceId,
      })
    )
  )

  // Persist variants and link to campaign_personas [B2 fixed: one content_item per persona]
  const allVariants: Array<{
    personaId: string
    platform: string
    variantId: string
    body: string
  }> = []
  let successCount = 0

  for (const result of generationResults) {
    if (result.status === 'rejected') {
      // Unexpected promise rejection (should not happen — generateForPersona catches internally)
      continue
    }

    const { personaId, workerResult, error } = result.value
    const campaignPersona = campaignPersonaByPersonaId[personaId]

    if (error || !workerResult) {
      await supabase
        .from('campaign_personas')
        .update({ generation_error: error ?? 'Generation failed' })
        .eq('id', campaignPersona.id)
      continue
    }

    // [B2] Create ONE content_item per persona (not per variant/platform)
    const contentItem = await createContentItem({
      workspace_id: workspaceId,
      ingestion_job_id,
      prompt_version_id: brandConfigs[persona_ids.indexOf(personaId)]?.current_prompt_version_id ?? null,
    })

    // Create post_variants for all platforms for this persona
    const postVariants = await createPostVariants(
      workerResult.variants.map(v => ({
        workspace_id: workspaceId,
        content_item_id: contentItem.id,  // [B2] all variants share this content_item
        platform: v.platform,
        body: v.body,
        status: 'draft' as const,
        persona_id: personaId,
      }))
    )

    // [B1] Link all variants to the campaign_persona via campaign_persona_variants
    await createCampaignPersonaVariants(
      campaignPersona.id,
      postVariants.map(v => ({ post_variant_id: v.id, platform: v.platform }))
    )

    postVariants.forEach(v => allVariants.push({
      personaId,
      platform: v.platform,
      variantId: v.id,
      body: v.body,
    }))
    successCount++
  }

  // [B8] Use renamed status values
  const finalStatus = successCount === 0
    ? 'failed'
    : successCount < persona_ids.length
    ? 'generation_partial'   // [B8] was 'partially_approved'
    : 'pending_approval'

  await updateCampaign(campaign.id, { status: finalStatus })
  await insertAuditEvent({
    workspace_id: workspaceId,
    event_type: 'campaign.created',
    entity_type: 'campaign',
    entity_id: campaign.id,
    metadata: { persona_count: persona_ids.length, success_count: successCount },
  })

  if (successCount === 0) {
    return NextResponse.json(
      { error: 'All persona generation attempts failed', campaign_id: campaign.id },
      { status: 502 }
    )
  }

  const personaMap = Object.fromEntries(personas.filter(Boolean).map(p => [p!.id, p!]))

  return NextResponse.json({
    campaign_id: campaign.id,
    status: finalStatus,
    variants: allVariants.map(v => ({
      persona_id: v.personaId,
      persona_name: personaMap[v.personaId]?.name ?? 'Unknown',
      platform: v.platform,
      variant_id: v.variantId,
      body: v.body,
    })),
  })
}
```

### 6.2 Update `POST /api/posts` — explicit backward compat contract [A14, B6]

**[B6] Clarification on what changes internally:**
`POST /api/posts` must remain a thin wrapper that calls the existing generation logic
**unchanged** internally. It does NOT delegate to `/api/campaigns` internally.
The only change is:
1. After variants are created via the existing path, also create a `campaigns` row and
   a `campaign_personas` row as a side effect (so every post is campaign-traceable).
2. Add `campaign_id` as an optional field to the response.

The response shape is **unchanged** — `ChatPage` reads `data.variants` and this must
continue to work without modification.

```typescript
// web/app/api/posts/route.ts
//
// INTERNAL CHANGE: after creating variants via existing path, also insert:
//   1. A campaigns row (status: 'completed' immediately — single persona, no approval needed)
//   2. A campaign_personas row (approval_status: 'approved' immediately)
//   3. campaign_persona_variants rows for each variant
// This makes all posts traceable via the campaign model without changing behavior.
//
// RESPONSE SHAPE — must remain exactly:
// { content_item_id, campaign_id?, variants: [{ id, platform, body, status }] }
// The campaign_id field is new and optional. Callers that ignore unknown fields are unaffected.

return NextResponse.json({
  content_item_id: contentItem.id,
  campaign_id: campaign.id,     // new optional field — existing callers ignore this
  variants: variants.map(v => ({
    id: v.id,
    platform: v.platform,
    body: v.body,
    status: v.status,
  })),
})
```

### 6.3 Other new routes

**`GET /api/personas`** — calls `getPersonasForWorkspace`, returns `{ personas: PersonaRow[] }`

**`POST /api/personas`** — validates name (1–50 chars), calls `createPersona`, returns 400 if workspace is at `PERSONA_SOFT_CAP`

**`GET /api/personas/:id`** — returns persona + brand_config summary + connections summary

**`PATCH /api/personas/:id`** — validates ownership, calls `updatePersona`

**`DELETE /api/personas/:id`** — validates ownership, calls `deletePersona` (which checks for active campaigns [S4])

**`POST /api/campaigns/:id/approve`** — approves all pending `campaign_personas` (or a subset via `persona_ids[]` body); for each approved persona, fetches all `campaign_persona_variants` and schedules them

**`POST /api/campaigns/:id/persona/:persona_id/approve`** — approves single persona; fetches all its `campaign_persona_variants` and schedules each variant

**`POST /api/campaigns/:id/persona/:persona_id/reject`** — sets `approval_status = 'rejected'`; does NOT delete variants

**`GET /api/campaigns`** — list campaigns for workspace, newest first (paginated)

**`GET /api/campaigns/:id`** — calls `getCampaignWithPersonas`

### 6.4 Update `web/app/api/brand/config/route.ts` [A19]

```typescript
const bodySchema = z.object({
  brand_name: z.string().min(1),
  industry: z.string().optional(),
  website_url: z.string().url().optional().or(z.literal('')).optional(),
  tone_tags: z.array(z.string()),
  system_prompt: z.string().min(1),
  persona_id: z.string().uuid().optional(),  // optional — defaults to workspace default persona
})

// In handler body:
const personaId = parsed.data.persona_id ?? (await getDefaultPersona(workspaceId))?.id
if (!personaId) return NextResponse.json({ error: 'No persona found' }, { status: 400 })

const brandConfig = await upsertBrandConfig({
  workspace_id: workspaceId,
  persona_id: personaId,
  // ...other fields...
})
```

### 6.5 Update `web/app/api/brand/voice-profile/route.ts` [A19]

Same pattern as §6.4: accept optional `persona_id` in request body, default to workspace default persona.

---

## 7. Worker Changes [BUILD NOW]

### 7.1 No worker interface changes

The worker's `WorkerGenerateRequest` takes `brand_system_prompt` as a string.
The caller (Next.js API route) fetches the persona's voice profile and passes it.
The worker does not know about personas. This is correct.

### 7.2 Parallel generation with proper abort [A22, B3]

**[B3] Fix:** The `AbortController` must be passed to `workerGenerate` so the underlying
`fetch` is actually cancelled on timeout — not just the promise. Using `Promise.race`
alone abandons the promise but leaves the HTTP connection open until the server responds.

`workerGenerate` must accept an optional `signal` parameter and forward it to `fetch`.

```typescript
// web/lib/adapters/worker.ts — add signal param to workerGenerate
export async function workerGenerate(
  params: WorkerGenerateRequest,
  signal?: AbortSignal
): Promise<WorkerGenerateResponse> {
  const res = await fetch(`${process.env.WORKER_URL}/generate`, {
    method: 'POST',
    headers: { /* ...existing headers... */ },
    body: JSON.stringify(params),
    signal,  // [B3] forwards cancellation to the HTTP layer
  })
  // ...existing response handling...
}
```

```typescript
// Self-contained generation function — one per persona, all fire in parallel
async function generateForPersona(params: {
  personaId: string
  brand: BrandConfigRow
  connections: SocialConnectionRow[]
  requestedPlatforms?: Platform[]
  job: IngestionJobRow
  workspaceId: string
}): Promise<{ personaId: string; workerResult?: WorkerGenerateResponse; error?: string }> {
  const connectedPlatforms = params.connections
    .filter(c => !c.needs_reauth)
    .map(c => c.platform) as Platform[]

  const platforms = params.requestedPlatforms
    ? params.requestedPlatforms.filter(p => connectedPlatforms.includes(p))
    : connectedPlatforms

  if (platforms.length === 0) {
    return { personaId: params.personaId, error: 'No connected platforms' }
  }

  // [B3] AbortController cancels the fetch when the timeout fires
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const workerResult = await workerGenerate(
      {
        workspace_id: params.workspaceId,
        extracted_title: params.job.extracted_title ?? '',
        extracted_text: params.job.extracted_text ?? '',
        brand_system_prompt: params.brand.custom_system_prompt!,
        platforms,
      },
      controller.signal   // [B3] pass signal so fetch is actually aborted
    )
    return { personaId: params.personaId, workerResult }
  } catch (err) {
    return {
      personaId: params.personaId,
      error: err instanceof Error ? err.message : 'Failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// All promises fire simultaneously — allSettled ensures all personas are attempted
const results = await Promise.allSettled(
  personasToGenerate.map(p => generateForPersona(p))
)
```

---

## 8. Frontend [BUILD NOW]

### 8.1 Route structure

```
/settings/personas                    — persona list
/settings/personas/new                — create wizard
/settings/personas/[id]               — persona hub
/settings/personas/[id]/voice         — voice config
/settings/personas/[id]/connections   — account connections
/settings/personas/[id]/schedule      — posting schedule
```

Add "Personas" to settings sidebar nav with `Users` icon from lucide-react.

### 8.2 Sidebar Settings link [A17]

**Always** point the Settings nav item to `/settings/personas`.
Do not make this conditional on persona count.
No data fetching needed in the Sidebar component.

```typescript
// In Sidebar.tsx, update the nav array:
{ name: 'Settings', href: '/settings/personas', icon: SlidersHorizontal },
```

### 8.3 Shared form components — do NOT clone [A15]

Instead of cloning existing settings pages, extract shared form components:

**Create `web/components/settings/BrandSettingsForm.tsx`**
Accepts `personaId: string` prop.
Loads brand config via `GET /api/personas/:id` (which includes brand_config).
Saves via `POST /api/brand/config` with `persona_id` in body.
The existing `/settings/brand/page.tsx` uses this component with the default persona's ID.
The new `/settings/personas/[id]/voice/page.tsx` also uses this component with the persona's ID.

**Create `web/components/settings/ConnectionsForm.tsx`**
Accepts `personaId: string` prop.
Shows connected platforms for that persona.
OAuth links include `?persona_id=<personaId>`.

**Create `web/components/settings/ScheduleForm.tsx`**
Accepts `personaId: string` prop.
Reads/writes posting schedules for that persona.

**Update existing settings pages to use the new shared components:**
```typescript
// web/app/(app)/settings/brand/page.tsx
export default async function BrandSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const defaultPersona = await getDefaultPersona(workspace!.workspace_id)
  return <BrandSettingsForm personaId={defaultPersona!.id} />
}
```

### 8.4 Chat page — persona selector

Zero-friction upgrade path:
- Single persona workspace → ExtractionCard renders exactly as today (no visual change)
- Multi-persona workspace → ExtractionCard shows persona selector

```typescript
// In ChatPage, fetch personas on mount (alongside connections fetch):
useEffect(() => {
  fetch('/api/personas')
    .then(r => r.json())
    .then(data => {
      setPersonas(data.personas ?? [])
      setSelectedPersonaIds((data.personas ?? []).map((p: PersonaRow) => p.id))
    })
}, [])
```

ExtractionCard additions — props only, no behavior change if `personas` is absent:
```typescript
type Props = {
  // ...existing props...
  personas?: PersonaRow[]
  selectedPersonaIds?: string[]
  onTogglePersona?: (id: string) => void
}
// Render persona selector only if personas?.length > 1
```

### 8.5 Updated generation flow in ChatPage

When the user submits content from the chat page, `handleGenerate`:
1. Calls `POST /api/campaigns` when `selectedPersonaIds.length > 1`
2. Calls `POST /api/posts` when only the default persona is selected (backward compat — no regression)
3. The response from `/api/campaigns` drives a new `ai-campaign` message type in `ChatMessage`

### 8.6 CampaignBatchCard with real-time state [A16, B7, S2]

**[B7] Option 1 removed.** The spec previously offered two approaches and included an
`ALTER TABLE campaigns ADD COLUMN current_stage TEXT` SQL block that looked like a migration step.
That column is NOT being added. The approach is option 2 only: subscribe to `campaign_personas`
changes via Supabase Realtime.

**[S2] Initial fetch required.** Before subscribing to Realtime, perform an initial
`getCampaignWithPersonas` fetch to populate the UI with any rows that already resolved
before the subscription was established. Without this, the card shows nothing until the
next Realtime event fires.

```typescript
// In ChatPage, when a campaign is created:
const [campaignState, setCampaignState] = useState<CampaignWithPersonas | null>(null)

useEffect(() => {
  if (!activeCampaignId) return

  // [S2] Initial fetch — populate before subscription to avoid blank state
  getCampaignWithPersonasClient(activeCampaignId).then(setCampaignState)

  const supabase = createBrowserSupabase()
  const channel = supabase
    .channel(`campaign-${activeCampaignId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'campaign_personas',
      filter: `campaign_id=eq.${activeCampaignId}`,
    }, () => {
      // Re-fetch the full campaign shape on any change (simpler than merging partial payloads)
      getCampaignWithPersonasClient(activeCampaignId).then(setCampaignState)
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [activeCampaignId])
```

**CampaignBatchCard in-progress state:**
While campaign is `generating`, show a `TypingIndicator` for each persona whose
`campaign_personas` row still has `approval_status = 'pending'` and no linked variants.
As each persona's variants arrive (detected via Realtime re-fetch), replace its
`TypingIndicator` with a persona variant preview chip.

**CampaignBatchCard final state (all generated):**
- Header: source title + "N personas" badge
- Body: one `PersonaVariantRow` per persona:
  - avatar + name | platform icon(s) | 80-char preview | Approve / Reject buttons
  - If the persona has multiple platforms (e.g., LinkedIn + X), show both platform icons
    and previews stacked under the same persona row
- Footer: "Approve All" (prominent) | "Reject All" (text link)
- On approve: call `POST /api/campaigns/:id/persona/:persona_id/approve`; show green checkmark immediately
- After approval: show mini VariantCard(s) (reuse existing) below the row with schedule info

---

## 9. What to NOT Build in This Phase

Calendar view, Telegram bot, Instagram connector, client approval portal,
smart scheduling/heatmap, team member invitations, full autopilot/confidence scoring,
WhatsApp bot.

**[S3] Campaign history UI is intentionally deferred.** `GET /api/campaigns` is built (list endpoint)
but there is no dedicated campaigns list page in Phase 2. Users see campaign results in the chat
stream only. A `/campaigns` history page with filtering and pagination is a Phase 3+ item.

These are explicitly deferred. Do not implement even if they seem easy or related.

---

## 10. Future-Proofing Constraints [FUTURE — CONSTRAIN ONLY]

### 10.1 Connector architecture (Phase 4)
Define `SUPPORTED_PLATFORMS` constant now (done in §3.0).
Do not add new platform-specific logic to adapter files.
Do not add new hardcoded `if (platform === 'linkedin')` branches beyond what exists.

### 10.2 Personas are not users yet
Do NOT store user identity on personas in this phase.
Do NOT build persona-level auth checks.
The `personas` table has no constraint that prevents adding `user_id UUID REFERENCES auth.users(id)` later.

### 10.3 Campaign is the canonical distribution unit
All new generation code calls `/api/campaigns`.
`/api/posts` is kept for backward compat only and internally wraps a campaign.
New UI code must never call `/api/posts` directly for new features.

### 10.4 Calendar-ready data
`post_variants` will have `persona_id` and `scheduled_at` (UTC ISO) for all new posts.
The calendar view reads these two fields. No schema changes needed in Phase 3 for the calendar.

### 10.5 RLS is incomplete [A24]
Current RLS grants full workspace access to all personas.
Phase 5+ team member ownership requires per-persona RLS on:
`brand_configs`, `social_connections`, `post_variants`, `posting_schedules`.
Do NOT treat current RLS as final. Flag it in code comments.

### 10.6 Audit actor model [A20]
`audit_events` has both `actor_user_id` (FK to auth.users) and `actor_external_id` (no FK).
Phase 6 client portal will use `actor_external_id` for external approvers.
Do not conflate these fields.

### 10.7 Campaign history UI (Phase 3)
`GET /api/campaigns` exists. A full `/campaigns` history page with filtering, re-approval
of old campaigns, and pagination is Phase 3+. Do not build it now.

---

## 11. Testing Checklist

### Phase 1 (Schema + Personas)
- [ ] Existing user data intact after migration (posts, connections, schedules still work)
- [ ] Default persona created for every existing workspace
- [ ] `getBrandConfig(workspaceId)` returns the correct brand config (not a random one)
- [ ] `upsertBrandConfig` succeeds on second call for same persona (no ambiguous conflict)
- [ ] New persona can be created, named, deleted
- [ ] Cannot delete the default persona (returns error)
- [ ] Cannot delete a persona with pending campaign_personas (returns error) [S4]
- [ ] OAuth start route without `persona_id` attaches to default persona (backward compat)
- [ ] OAuth start route with invalid `persona_id` returns 404
- [ ] OAuth state cookie contains `randomHex:personaId` format, extracted with `indexOf` [B5]
- [ ] Connection after OAuth attaches to the specified persona, not the workspace
- [ ] `POST /api/personas` returns 400 when workspace is at `PERSONA_SOFT_CAP`
- [ ] RLS: user cannot see or modify another workspace's personas

### Phase 2 (Campaigns)
- [ ] Campaign creation rejected if ingestion job's `extracted_text` is empty [S1]
- [ ] Campaign created from completed ingestion job with multiple personas
- [ ] All persona generation calls fire in parallel (not sequential)
- [ ] If one persona's generation fails, campaign continues for others
- [ ] Campaign status is `generation_partial` when some personas fail, `failed` when all fail [B8]
- [ ] Zombie campaign detection: `generating` campaign older than 3 min → reset to `failed`
- [ ] Approving a campaign_persona schedules ALL its variants (all platforms) [B1]
- [ ] A persona with 2 platforms generates 2 `campaign_persona_variants` rows [B1]
- [ ] ONE `content_item` created per persona per campaign (not per variant) [B2]
- [ ] Timeout on worker call actually aborts the HTTP request (verify with network tool) [B3]
- [ ] Rejecting does not delete variants (sets approval_status = 'rejected' only)
- [ ] `POST /api/posts` response shape is unchanged (backward compat) [B6]
- [ ] `POST /api/posts` creates a campaign row as side effect (status: 'completed') [B6]
- [ ] `ChatPage` works with single default persona (no regression, no persona selector shown)
- [ ] Persona selector appears only when workspace has 2+ personas
- [ ] CampaignBatchCard shows correct state from initial fetch before Realtime fires [S2]
- [ ] `claim_due_variants` RPC skips personas at daily rate limit
- [ ] `claim_due_variants` does NOT apply rate limiting to variants with `persona_id IS NULL`
- [ ] Audit events inserted for: `campaign.created`, `campaign_persona.approved`, `post.published`, `post.failed`
- [ ] Campaign generation rate limit: 2 per minute per workspace

---

## 12. File Change Summary

### New files
```
web/lib/constants/platforms.ts
web/lib/db/personas.ts
web/lib/db/campaigns.ts
web/lib/db/audit-events.ts
web/lib/db/persona-rate-limits.ts
web/components/settings/BrandSettingsForm.tsx
web/components/settings/ConnectionsForm.tsx
web/components/settings/ScheduleForm.tsx
web/app/(app)/settings/personas/page.tsx
web/app/(app)/settings/personas/new/page.tsx
web/app/(app)/settings/personas/[id]/page.tsx
web/app/(app)/settings/personas/[id]/voice/page.tsx
web/app/(app)/settings/personas/[id]/connections/page.tsx
web/app/(app)/settings/personas/[id]/schedule/page.tsx
web/app/(app)/chat/_components/CampaignBatchCard.tsx
web/app/(app)/chat/_components/PersonaSelector.tsx
web/app/api/personas/route.ts
web/app/api/personas/[id]/route.ts
web/app/api/campaigns/route.ts
web/app/api/campaigns/[id]/route.ts
web/app/api/campaigns/[id]/approve/route.ts
web/app/api/campaigns/[id]/persona/[persona_id]/approve/route.ts
web/app/api/campaigns/[id]/persona/[persona_id]/reject/route.ts
supabase/migrations/YYYYMMDD_persona_architecture.sql
```

### Modified files
```
web/components/app/Sidebar.tsx                        — Settings href → /settings/personas [A17]
web/app/(app)/settings/layout.tsx                     — add Personas nav item
web/app/(app)/settings/brand/page.tsx                 — use BrandSettingsForm component [A15]
web/app/(app)/settings/connections/page.tsx            — use ConnectionsForm component [A15]
web/app/(app)/settings/schedule/page.tsx               — use ScheduleForm component [A15]
web/app/(app)/chat/page.tsx                           — persona selector, campaign flow, Realtime [A16, S2]
web/app/(app)/chat/_components/ExtractionCard.tsx     — optional persona selector props
web/app/api/oauth/linkedin/start/route.ts              — state = hex:personaId, indexOf extract [A1, A10, B5]
web/app/api/oauth/linkedin/callback/route.ts           — indexOf extract [A1, B5]
web/app/api/oauth/x/start/route.ts                    — same pattern as LinkedIn [A1, A10, B5]
web/app/api/oauth/x/callback/route.ts                 — same pattern as LinkedIn [A1, B5]
web/app/api/posts/route.ts                            — campaign side-effect, explicit response shape [A14, B6]
web/app/api/connections/route.ts                      — accept ?persona_id query param
web/app/api/schedule-slots/route.ts                   — accept ?persona_id query param
web/app/api/queue/route.ts                            — accept ?persona_id query param
web/app/api/cron/publish-due/route.ts                 — zombie campaign cleanup [A5], persona rate limits [A4]
web/app/api/brand/config/route.ts                     — accept persona_id in body [A19]
web/app/api/brand/voice-profile/route.ts              — accept persona_id in body [A19]
web/lib/db/brand-configs.ts                           — getBrandConfig fix [A9], upsert fix [A2]
web/lib/db/social-connections.ts                      — persona-scoped functions
web/lib/db/posting-schedules.ts                       — persona-scoped function
web/lib/db/posts.ts                                   — thread persona_id through createPostVariants
web/lib/adapters/worker.ts                            — add optional signal param to workerGenerate [B3]
```

### Unchanged files
```
worker/*                    — no worker interface changes
web/lib/adapters/linkedin.ts
web/lib/adapters/x.ts
web/lib/security/vault.ts
web/lib/supabase/*
web/app/(auth)/*
web/app/api/ingest/*
web/app/api/media/*
web/app/api/posts/[id]/*    — operate by variant ID, persona already embedded
```

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| Workspace | Top-level organization container. Unchanged from existing. |
| Persona | Named identity inside a workspace. Has its own voice, accounts, queue. NEW. |
| Default Persona | Auto-created during migration. Wraps existing workspace setup. One per workspace. |
| Campaign | One source content item distributed across selected personas. NEW. |
| Campaign Persona | Join record: campaign + persona + approval status. No longer holds a single variant FK. UPDATED [B1]. |
| Campaign Persona Variant | Join record linking a campaign_persona to one of its generated post_variants (one per platform). NEW [B1]. |
| Variant | Generated post for a specific platform. Now persona-scoped. UPDATED. |
| Voice Profile | Structured JSON describing writing style. Stored in brand_configs per persona. EXISTING. |
| Zombie Campaign | Campaign stuck in `generating` state due to timeout. Reset to `failed` by cron. NEW. |
| generation_partial | Campaign status: some personas generated successfully, some failed. Formerly `partially_approved` [B8]. |

---

*This is spec v3. It supersedes spec v2 entirely.
v2 issues A1–A25 are all resolved.
v3 issues B1–B9, S1–S4 are all resolved in this version.
Agents: follow this document. When ambiguous, ask before assuming.*
