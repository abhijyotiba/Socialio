# Multi-Persona Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-persona workspace support and a campaign distribution model to SocialOS so one piece of source content can generate and schedule variants across N personas simultaneously.

**Architecture:** Additive schema migration (`personas` table + campaign tables) threads through existing tables via `persona_id` FK. A new `/api/campaigns` route handles parallel per-persona generation using the existing `workerGenerate` client. Frontend adds a persona selector in ChatPage and a `CampaignBatchCard` component with Supabase Realtime streaming.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS + Realtime), TypeScript strict, Zod, Vitest, shadcn/ui, Tailwind CSS

**Spec:** `Socialos phase2 implementation spec.md` (v3) — follow it exactly. This plan operationalises it.

---

## Phase 2.1 — Database Foundation

### Task 1: Constants file

**Files:**
- Create: `web/lib/constants/platforms.ts`

- [ ] **Step 1: Create the file**

```typescript
// web/lib/constants/platforms.ts
export const SUPPORTED_PLATFORMS = ['linkedin', 'x'] as const
export type Platform = typeof SUPPORTED_PLATFORMS[number]

export const PERSONA_SOFT_CAP = 10
export const PERSONA_HARD_CAP = 50

// IMPORTANT [B4]: Values duplicated in claim_due_variants SQL RPC.
// When changing these, also update the CASE statement in that RPC (migration 0014).
export const PLATFORM_DAILY_LIMITS: Record<Platform, number> = {
  linkedin: 20,
  x: 50,
}

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  linkedin: 3000,
  x: 280,
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && pnpm tsc --noEmit
```
Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add web/lib/constants/platforms.ts
git commit -m "feat: add platform constants (SUPPORTED_PLATFORMS, caps, limits)"
```

---

### Task 2: Migration — `set_updated_at` trigger + `personas` table + data migration

**Files:**
- Create: `supabase/migrations/0014_persona_architecture.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/0014_persona_architecture.sql

-- ── 0. updated_at trigger function ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. personas table ────────────────────────────────────────────────────────
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

CREATE UNIQUE INDEX personas_workspace_default_idx
  ON personas(workspace_id) WHERE is_default = true;

CREATE TRIGGER personas_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY personas_workspace_isolation ON personas
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── 2. Seed default personas for existing workspaces ─────────────────────────
INSERT INTO personas (workspace_id, name, slug, is_default, avatar_color)
SELECT
  id AS workspace_id,
  COALESCE(NULLIF(TRIM(name), ''), 'Main Account') AS name,
  'main-account' AS slug,
  true AS is_default,
  '#6366f1' AS avatar_color
FROM workspaces
ON CONFLICT DO NOTHING;

-- Assertion: every workspace must have a default persona
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

-- ── 3. brand_configs: add persona_id ─────────────────────────────────────────
ALTER TABLE brand_configs ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;

UPDATE brand_configs bc
SET persona_id = p.id
FROM personas p
WHERE p.workspace_id = bc.workspace_id AND p.is_default = true;

DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM brand_configs WHERE persona_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % brand_configs rows have no persona_id', null_count;
  END IF;
END $$;

ALTER TABLE brand_configs ALTER COLUMN persona_id SET NOT NULL;
ALTER TABLE brand_configs DROP CONSTRAINT IF EXISTS brand_configs_workspace_id_key;
ALTER TABLE brand_configs ADD CONSTRAINT brand_configs_persona_id_key UNIQUE (persona_id);

-- ── 4. social_connections: add persona_id ────────────────────────────────────
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
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_workspace_id_platform_key;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_persona_platform_key
  UNIQUE (persona_id, platform);

-- ── 5. posting_schedules: add persona_id ─────────────────────────────────────
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

-- ── 6. post_variants: add persona_id (nullable — old posts are allowed NULL) ──
ALTER TABLE post_variants ADD COLUMN persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;

UPDATE post_variants pv
SET persona_id = p.id
FROM content_items ci
JOIN personas p ON p.workspace_id = ci.workspace_id AND p.is_default = true
WHERE pv.content_item_id = ci.id AND pv.persona_id IS NULL;

-- ── 7. campaigns table ────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ingestion_job_id      UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  title                 TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'generating', 'pending_approval', 'generation_partial',
      'approved', 'scheduled', 'completed', 'failed'
    )),
  generation_started_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_workspace_status_idx ON campaigns(workspace_id, status);
CREATE INDEX campaigns_zombie_detection_idx ON campaigns(status, generation_started_at)
  WHERE status = 'generating';

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_workspace_isolation ON campaigns
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── 8. campaign_personas table ────────────────────────────────────────────────
CREATE TABLE campaign_personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  approval_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  generation_error TEXT,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, persona_id)
);

CREATE INDEX campaign_personas_campaign_idx ON campaign_personas(campaign_id);

CREATE TRIGGER campaign_personas_updated_at
  BEFORE UPDATE ON campaign_personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaign_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_personas_workspace_isolation ON campaign_personas
  USING (campaign_id IN (
    SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids())
  ));

-- ── 9. campaign_persona_variants table ───────────────────────────────────────
CREATE TABLE campaign_persona_variants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_persona_id  UUID NOT NULL REFERENCES campaign_personas(id) ON DELETE CASCADE,
  post_variant_id      UUID NOT NULL REFERENCES post_variants(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_persona_id, post_variant_id)
);

CREATE INDEX campaign_persona_variants_campaign_persona_idx
  ON campaign_persona_variants(campaign_persona_id);

ALTER TABLE campaign_persona_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_persona_variants_workspace_isolation ON campaign_persona_variants
  USING (campaign_persona_id IN (
    SELECT cp.id FROM campaign_personas cp
    JOIN campaigns c ON c.id = cp.campaign_id
    WHERE c.workspace_id IN (SELECT user_workspace_ids())
  ));

-- ── 10. audit_events table ────────────────────────────────────────────────────
CREATE TABLE audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  persona_id        UUID REFERENCES personas(id) ON DELETE SET NULL,
  actor_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_external_id TEXT,
  event_type        TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         UUID NOT NULL,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_workspace_created_idx ON audit_events(workspace_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_workspace_isolation ON audit_events
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── 11. persona_rate_limits table ─────────────────────────────────────────────
CREATE TABLE persona_rate_limits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id   UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  posts_today  INTEGER NOT NULL DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  day_reset_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(persona_id, platform)
);

CREATE TRIGGER persona_rate_limits_updated_at
  BEFORE UPDATE ON persona_rate_limits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE persona_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY persona_rate_limits_workspace_isolation ON persona_rate_limits
  USING (persona_id IN (
    SELECT id FROM personas WHERE workspace_id IN (SELECT user_workspace_ids())
  ));

-- ── 12. bot_sessions table (schema only — no bot functionality in Phase 2) ────
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
  UNIQUE(channel, external_user_id, workspace_id)
);

ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_sessions_workspace_isolation ON bot_sessions
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- ── 13. claim_due_variants: extend with persona rate limit check ──────────────
-- Find the existing claim_due_variants function and add the rate limit AND clause.
-- [B4] KEEP IN SYNC WITH PLATFORM_DAILY_LIMITS in web/lib/constants/platforms.ts
-- The following is a CREATE OR REPLACE for the full function.
-- Paste the full existing function body here, adding the rate limit condition:
--   AND (
--     pv.persona_id IS NULL
--     OR NOT EXISTS (
--       SELECT 1 FROM persona_rate_limits prl
--       WHERE prl.persona_id = pv.persona_id
--         AND prl.platform = pv.platform
--         AND prl.day_reset_at = CURRENT_DATE
--         AND prl.posts_today >= (
--           CASE pv.platform
--             WHEN 'linkedin' THEN 20
--             WHEN 'x' THEN 50
--             ELSE 999
--           END
--         )
--     )
--   )
-- NOTE: Look up the current claim_due_variants definition in migration 0009_cron_helpers.sql
-- and recreate it here with this additional WHERE clause condition added.
```

- [ ] **Step 2: Check existing claim_due_variants definition**

```bash
grep -n "claim_due_variants" supabase/migrations/0009_cron_helpers.sql
```

Read the full function body, then update the migration to include the correct `CREATE OR REPLACE FUNCTION claim_due_variants(...)` with the rate limit AND clause added to the WHERE on `post_variants`.

- [ ] **Step 3: Apply migration**

```bash
supabase db push
```
Expected: migration applies without error.

- [ ] **Step 4: Regenerate TS types**

```bash
cd web && pnpm gen:types
```
Expected: `web/lib/db/types.ts` now includes `personas`, `campaigns`, `campaign_personas`, `campaign_persona_variants`, `audit_events`, `persona_rate_limits`, `bot_sessions` tables.

- [ ] **Step 5: Verify app still starts**

```bash
cd web && pnpm build 2>&1 | tail -20
```
Expected: no TS errors. Build may warn about unused imports added by type gen — that's fine.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0014_persona_architecture.sql web/lib/db/types.ts
git commit -m "feat: persona architecture migration — personas, campaigns, rate limits, audit"
```

---

## Phase 2.2 — DB Helper Layer

### Task 3: `web/lib/db/personas.ts`

**Files:**
- Create: `web/lib/db/personas.ts`
- Create: `web/lib/db/__tests__/personas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// web/lib/db/__tests__/personas.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase client
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))

// Helper: chain builder
function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  const methods = ['select','insert','update','delete','eq','neq','lt','in','order',
    'limit','single','maybeSingle','select']
  methods.forEach(m => { c[m] = vi.fn().mockReturnValue(c) })
  c['then'] = undefined  // not a promise itself
  // terminal call returns the result
  ;(c.single as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(c.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  return c
}

describe('deletePersona', () => {
  it('throws if persona is default', async () => {
    const { deletePersona } = await import('@/lib/db/personas')

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { is_default: true }, error: null }),
        }),
      }),
    })

    await expect(deletePersona('some-id')).rejects.toThrow('Cannot delete the default persona')
  })

  it('throws if persona has pending campaigns', async () => {
    const { deletePersona } = await import('@/lib/db/personas')

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { is_default: false }, error: null }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }
    })

    await expect(deletePersona('some-id')).rejects.toThrow('pending campaigns')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd web && pnpm vitest run lib/db/__tests__/personas.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/lib/db/personas.ts`**

```typescript
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'
import { PERSONA_HARD_CAP } from '@/lib/constants/platforms'

type PersonaRow = Database['public']['Tables']['personas']['Row']

export async function generatePersonaSlug(workspaceId: string, name: string): Promise<string> {
  const supabase = await createClient()
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'persona'
  for (let i = 0; i <= 10; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const { data } = await supabase
      .from('personas').select('id').eq('workspace_id', workspaceId).eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now()}`
}

export async function getPersonasForWorkspace(workspaceId: string): Promise<PersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('personas').select('*').eq('workspace_id', workspaceId)
    .order('is_default', { ascending: false }).order('created_at', { ascending: true })
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
    .from('personas').select('*').eq('workspace_id', workspaceId).eq('is_default', true).single()
  return data
}

export async function createPersona(
  workspaceId: string, name: string, avatarColor?: string
): Promise<PersonaRow> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('personas').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  if ((count ?? 0) >= PERSONA_HARD_CAP) {
    throw new Error(`Workspace has reached the maximum of ${PERSONA_HARD_CAP} personas`)
  }
  const slug = await generatePersonaSlug(workspaceId, name)
  const { data, error } = await supabase
    .from('personas')
    .insert({ workspace_id: workspaceId, name, slug, avatar_color: avatarColor ?? '#6366f1' })
    .select().single()
  if (error) throw error
  return data
}

export async function updatePersona(
  id: string, patch: Pick<Partial<PersonaRow>, 'name' | 'avatar_color'>
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('personas').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePersona(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: persona } = await supabase
    .from('personas').select('is_default').eq('id', id).single()
  if (persona?.is_default) throw new Error('Cannot delete the default persona')

  const { count: activeCampaignCount } = await supabase
    .from('campaign_personas').select('id', { count: 'exact', head: true })
    .eq('persona_id', id).eq('approval_status', 'pending')
  if ((activeCampaignCount ?? 0) > 0) {
    throw new Error('Cannot delete a persona with pending campaigns. Reject or complete them first.')
  }

  const { error } = await supabase.from('personas').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd web && pnpm vitest run lib/db/__tests__/personas.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/personas.ts web/lib/db/__tests__/personas.test.ts
git commit -m "feat: add personas DB helpers with active-campaign delete guard"
```

---

### Task 4: `web/lib/db/campaigns.ts`

**Files:**
- Create: `web/lib/db/campaigns.ts`

- [ ] **Step 1: Create the file**

```typescript
// web/lib/db/campaigns.ts
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignInsert = Database['public']['Tables']['campaigns']['Insert']
type CampaignPersonaRow = Database['public']['Tables']['campaign_personas']['Row']
type CampaignPersonaVariantRow = Database['public']['Tables']['campaign_persona_variants']['Row']

export type CampaignWithPersonas = CampaignRow & {
  campaign_personas: Array<CampaignPersonaRow & {
    persona: { id: string; name: string; avatar_color: string; slug: string }
    variants: Array<{
      id: string
      platform: string
      post_variant_id: string
      body: string
      status: string
    }>
  }>
}

export async function createCampaign(values: CampaignInsert): Promise<CampaignRow> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('campaigns').insert(values).select().single()
  if (error) throw error
  return data
}

export async function updateCampaign(id: string, patch: Partial<CampaignRow>): Promise<void> {
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
  campaignId: string, personaIds: string[]
): Promise<CampaignPersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaign_personas')
    .insert(personaIds.map(personaId => ({ campaign_id: campaignId, persona_id: personaId })))
    .select()
  if (error) throw error
  return data ?? []
}

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
  campaignPersonaId: string, status: 'approved' | 'rejected'
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

export async function getVariantsForCampaignPersona(campaignPersonaId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaign_persona_variants')
    .select('post_variant_id')
    .eq('campaign_persona_id', campaignPersonaId)
  return (data ?? []).map(row => row.post_variant_id)
}

export async function countRecentCampaigns(workspaceId: string, windowSeconds: number): Promise<number> {
  const supabase = await createClient()
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { count } = await supabase
    .from('campaigns').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).gte('created_at', since)
  return count ?? 0
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "campaigns.ts"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/db/campaigns.ts
git commit -m "feat: add campaigns DB helpers (create, approve, variants join)"
```

---

### Task 5: `audit-events.ts` + `persona-rate-limits.ts`

**Files:**
- Create: `web/lib/db/audit-events.ts`
- Create: `web/lib/db/persona-rate-limits.ts`

- [ ] **Step 1: Create `audit-events.ts`**

```typescript
// web/lib/db/audit-events.ts
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

export async function insertAuditEvent(event: AuditEventInsert): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('audit_events').insert(event)
  } catch {
    // Audit must never break the main flow
  }
}
```

- [ ] **Step 2: Create `persona-rate-limits.ts`**

```typescript
// web/lib/db/persona-rate-limits.ts
import { createClient } from '@/lib/supabase/server'
import { PLATFORM_DAILY_LIMITS, type Platform } from '@/lib/constants/platforms'

export async function checkAndIncrementRateLimit(
  personaId: string, platform: Platform
): Promise<boolean> {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]  // YYYY-MM-DD UTC
  const dailyLimit = PLATFORM_DAILY_LIMITS[platform]

  const { data: existing } = await supabase
    .from('persona_rate_limits').select('*')
    .eq('persona_id', personaId).eq('platform', platform).maybeSingle()

  if (!existing) {
    await supabase.from('persona_rate_limits').insert({
      persona_id: personaId, platform, posts_today: 1,
      last_post_at: new Date().toISOString(), day_reset_at: today,
    })
    return true
  }

  const count = existing.day_reset_at < today ? 0 : existing.posts_today
  if (count >= dailyLimit) return false

  await supabase.from('persona_rate_limits')
    .update({ posts_today: count + 1, last_post_at: new Date().toISOString(), day_reset_at: today })
    .eq('persona_id', personaId).eq('platform', platform)

  return true
}
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/db/audit-events.ts web/lib/db/persona-rate-limits.ts
git commit -m "feat: add audit-events and persona-rate-limits DB helpers"
```

---

### Task 6: Update `brand-configs.ts` and `social-connections.ts`

**Files:**
- Modify: `web/lib/db/brand-configs.ts`
- Modify: `web/lib/db/social-connections.ts`

- [ ] **Step 1: Update `brand-configs.ts`**

Add these functions (keep all existing functions unchanged):

```typescript
// Add to web/lib/db/brand-configs.ts — after existing functions

// [A9] Prefer this over getBrandConfig(workspaceId) in new code paths
export async function getBrandConfigForPersona(personaId: string): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs').select('*').eq('persona_id', personaId).single()
  return data
}
```

Replace the existing `getBrandConfig` body to fix [A9]:

```typescript
export async function getBrandConfig(workspaceId: string): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('brand_configs')
    .select('*, personas!inner(workspace_id, is_default)')
    .eq('personas.workspace_id', workspaceId)
    .eq('personas.is_default', true)
    .single()
  if (error) return null
  return data
}
```

Replace the existing `upsertBrandConfig` to fix [A2] — add explicit `onConflict`:

```typescript
export async function upsertBrandConfig(values: BrandConfigInsert): Promise<BrandConfigRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('brand_configs')
    .upsert(values, { onConflict: 'persona_id' })
    .select().single()
  if (error) throw error
  return data
}
```

- [ ] **Step 2: Update `social-connections.ts`**

Add these persona-scoped functions (keep existing `getSocialConnection`, `getActiveSocialConnections`, `upsertSocialConnection` unchanged):

```typescript
// Add to web/lib/db/social-connections.ts

export async function getSocialConnectionForPersona(
  personaId: string, platform: string
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections').select('*')
    .eq('persona_id', personaId).eq('platform', platform).maybeSingle()
  return data
}

export async function getConnectionsForPersona(personaId: string): Promise<SocialConnectionRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections').select('*').eq('persona_id', personaId)
  return data ?? []
}
```

Also update `upsertSocialConnection` — change the `onConflict` value from `"workspace_id,platform"` to `"persona_id,platform"`:

```typescript
export async function upsertSocialConnection(
  values: SocialConnectionInsert,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic Supabase client
  clientOverride?: any
): Promise<SocialConnectionRow> {
  const supabase = clientOverride ?? (await createClient())
  const { data, error } = await supabase
    .from('social_connections')
    .upsert(values, { onConflict: 'persona_id,platform' })  // updated: was workspace_id,platform
    .select().single()
  if (error) throw error
  return data
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep -E "brand-configs|social-connections"
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/db/brand-configs.ts web/lib/db/social-connections.ts
git commit -m "fix: persona-scope brand-configs and social-connections DB helpers"
```

---

## Phase 2.3 — OAuth Flow

### Task 7: LinkedIn OAuth — embed `persona_id` in state

**Files:**
- Modify: `web/app/api/oauth/linkedin/start/route.ts`
- Modify: `web/app/api/oauth/linkedin/callback/route.ts`

- [ ] **Step 1: Update LinkedIn start route**

Replace the full content of `web/app/api/oauth/linkedin/start/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizationUrl } from '@/lib/adapters/linkedin'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getDefaultPersona, getPersona } from '@/lib/db/personas'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

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

  // [A1] Format: "<32-char hex>:<persona-uuid>"
  const state = `${randomBytes(16).toString('hex')}:${personaId}`
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

- [ ] **Step 2: Update LinkedIn callback route**

Replace the full content of `web/app/api/oauth/linkedin/callback/route.ts`:

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens, getUserInfo } from '@/lib/adapters/linkedin'
import { createSecret } from '@/lib/security/vault'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { upsertSocialConnection } from '@/lib/db/social-connections'
import { getPersona } from '@/lib/db/personas'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('linkedin_oauth_state')?.value
  if (!savedState || savedState !== state) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // [B5] Use indexOf + slice — safe against UUIDs or future format changes
  const colonIdx = savedState.indexOf(':')
  if (colonIdx === -1) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }
  const personaId = savedState.slice(colonIdx + 1)
  if (!personaId) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  // Defense in depth — verify persona ownership
  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona mismatch' }, { status: 403 })
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch {
    return NextResponse.json({ error: 'LinkedIn token exchange failed' }, { status: 502 })
  }

  cookieStore.delete('linkedin_oauth_state')

  const admin = createAdminClient()
  const workspaceId = workspace.workspace_id
  const accessVaultId = await createSecret(admin, tokens.access_token, `linkedin:access:${workspaceId}:${personaId}`)

  let refreshVaultId: string | null = null
  if (tokens.refresh_token) {
    refreshVaultId = await createSecret(admin, tokens.refresh_token, `linkedin:refresh:${workspaceId}:${personaId}`)
  }

  let platformUserId: string | null = null
  let platformUsername: string | null = null
  try {
    const info = await getUserInfo(tokens.access_token)
    platformUserId = info.sub
    platformUsername = info.name ?? info.email ?? null
  } catch {
    // non-fatal
  }

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await upsertSocialConnection({
    workspace_id: workspaceId,
    persona_id: personaId,
    platform: 'linkedin',
    platform_user_id: platformUserId,
    platform_username: platformUsername,
    access_token_vault_id: accessVaultId,
    refresh_token_vault_id: refreshVaultId,
    token_expires_at: tokenExpiresAt,
    needs_reauth: false,
  }, admin)

  return NextResponse.redirect(
    new URL(`/settings/personas/${personaId}/connections?linkedin=connected`, request.url)
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "oauth/linkedin"
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/oauth/linkedin/start/route.ts web/app/api/oauth/linkedin/callback/route.ts
git commit -m "feat: LinkedIn OAuth — embed persona_id in state, validate persona ownership"
```

---

### Task 8: X OAuth — same pattern as LinkedIn

**Files:**
- Modify: `web/app/api/oauth/x/start/route.ts`
- Modify: `web/app/api/oauth/x/callback/route.ts`

- [ ] **Step 1: Read the X callback route to understand current shape**

```bash
cat web/app/api/oauth/x/callback/route.ts
```

- [ ] **Step 2: Update X start route**

Replace full content of `web/app/api/oauth/x/start/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes, createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizationUrl } from '@/lib/adapters/x'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getDefaultPersona, getPersona } from '@/lib/db/personas'

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  let personaId = new URL(request.url).searchParams.get('persona_id')
  if (!personaId) {
    const defaultPersona = await getDefaultPersona(workspace.workspace_id)
    if (!defaultPersona) return NextResponse.json({ error: 'No default persona' }, { status: 400 })
    personaId = defaultPersona.id
  }

  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
  }

  // [A1] Format: "<32-char hex>:<persona-uuid>"
  const state = `${randomBytes(16).toString('hex')}:${personaId}`
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  const cookieStore = await cookies()
  cookieStore.set('x_oauth_state', state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 600, path: '/',
  })
  cookieStore.set('x_code_verifier', codeVerifier, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 600, path: '/',
  })

  return NextResponse.redirect(buildAuthorizationUrl(state, codeChallenge))
}
```

- [ ] **Step 3: Update X callback route**

Read existing callback then update to add:
1. Extract `personaId` from state using `indexOf(':')` + `slice` (same as LinkedIn)
2. Validate persona ownership
3. Pass `persona_id` to `upsertSocialConnection`
4. Redirect to `/settings/personas/${personaId}/connections?x=connected`

The pattern is identical to the LinkedIn callback (Task 7 Step 2). Adapt it using the X-specific token exchange function from `@/lib/adapters/x`.

- [ ] **Step 4: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "oauth/x"
git add web/app/api/oauth/x/start/route.ts web/app/api/oauth/x/callback/route.ts
git commit -m "feat: X OAuth — embed persona_id in state, validate persona ownership"
```

---

## Phase 2.4 — Persona API Routes

### Task 9: `GET /api/personas` + `POST /api/personas`

**Files:**
- Create: `web/app/api/personas/route.ts`

- [ ] **Step 1: Create the file**

```typescript
// web/app/api/personas/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersonasForWorkspace, createPersona } from '@/lib/db/personas'
import { PERSONA_SOFT_CAP } from '@/lib/constants/platforms'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const personas = await getPersonasForWorkspace(workspace.workspace_id)
  return NextResponse.json({ personas })
}

const createSchema = z.object({
  name: z.string().min(1).max(50),
  avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const personas = await getPersonasForWorkspace(workspace.workspace_id)
  if (personas.length >= PERSONA_SOFT_CAP) {
    return NextResponse.json(
      { error: `Workspace has reached the ${PERSONA_SOFT_CAP}-persona limit` },
      { status: 400 }
    )
  }

  try {
    const persona = await createPersona(
      workspace.workspace_id, parsed.data.name, parsed.data.avatar_color
    )
    return NextResponse.json({ persona }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create persona'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

- [ ] **Step 2: Create `web/app/api/personas/[id]/route.ts`**

```typescript
// web/app/api/personas/[id]/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona, updatePersona, deletePersona } from '@/lib/db/personas'
import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [brandConfig, connections] = await Promise.all([
    getBrandConfigForPersona(id),
    getConnectionsForPersona(id),
  ])

  return NextResponse.json({
    persona,
    brand_config: brandConfig ? {
      brand_name: brandConfig.brand_name,
      has_voice_profile: !!brandConfig.custom_system_prompt,
    } : null,
    connections: connections.map(c => ({ platform: c.platform, needs_reauth: c.needs_reauth })),
  })
}

const patchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  await updatePersona(id, parsed.data)
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await deletePersona(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "api/personas"
git add web/app/api/personas/route.ts web/app/api/personas/[id]/route.ts
git commit -m "feat: GET/POST /api/personas and GET/PATCH/DELETE /api/personas/[id]"
```

---

## Phase 2.5 — Campaign API Route

### Task 10: `workerGenerate` — add abort signal

**Files:**
- Modify: `web/lib/worker-client.ts`

- [ ] **Step 1: Update `workerGenerate` signature**

In `web/lib/worker-client.ts`, replace the `workerGenerate` function:

```typescript
export async function workerGenerate(
  req: WorkerGenerateRequest,
  signal?: AbortSignal   // [B3] optional — pass to fetch so timeout actually cancels the connection
): Promise<WorkerGenerateResponse> {
  const body = JSON.stringify(req)
  const res = await fetch(`${process.env.WORKER_URL}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Signature': signBody(body),
    },
    body,
    signal: signal ?? AbortSignal.timeout(25_000),  // caller's signal takes precedence
  })
  if (!res.ok) {
    throw new Error(`Worker /generate responded ${res.status}`)
  }
  return res.json() as Promise<WorkerGenerateResponse>
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "worker-client"
git add web/lib/worker-client.ts
git commit -m "fix: workerGenerate accepts AbortSignal so timeouts cancel the HTTP connection"
```

---

### Task 11: `POST /api/campaigns`

**Files:**
- Create: `web/app/api/campaigns/route.ts`

- [ ] **Step 1: Create the file**

```typescript
// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getIngestionJob } from '@/lib/db/ingestion'
import { getPersona } from '@/lib/db/personas'
import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'
import { createContentItem, createPostVariants } from '@/lib/db/posts'
import {
  createCampaign, updateCampaign, createCampaignPersonas, createCampaignPersonaVariants,
  countRecentCampaigns,
} from '@/lib/db/campaigns'
import { insertAuditEvent } from '@/lib/db/audit-events'
import { workerGenerate, type WorkerGenerateResponse } from '@/lib/worker-client'
import { SUPPORTED_PLATFORMS, PERSONA_SOFT_CAP, type Platform } from '@/lib/constants/platforms'
import type { Database } from '@/lib/db/types'

type BrandConfigRow = Database['public']['Tables']['brand_configs']['Row']
type SocialConnectionRow = Database['public']['Tables']['social_connections']['Row']
type IngestionJobRow = Database['public']['Tables']['ingestion_jobs']['Row']

const bodySchema = z.object({
  ingestion_job_id: z.string().uuid(),
  persona_ids: z.array(z.string().uuid()).min(1).max(PERSONA_SOFT_CAP),
  platforms: z.array(z.enum(SUPPORTED_PLATFORMS)).optional(),
})

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

  // [B3] AbortController so the fetch is actually cancelled on timeout
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
      controller.signal
    )
    return { personaId: params.personaId, workerResult }
  } catch (err) {
    return { personaId: params.personaId, error: err instanceof Error ? err.message : 'Failed' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  const workspaceId = workspace.workspace_id

  // [A23] Rate limit: 2 campaigns per minute per workspace
  const perMinute = await countRecentCampaigns(workspaceId, 60)
  if (perMinute >= 2) {
    return NextResponse.json({ error: 'Rate limit: 2 campaigns per minute' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { ingestion_job_id, persona_ids, platforms: requestedPlatforms } = parsed.data

  const job = await getIngestionJob(ingestion_job_id)
  if (!job || job.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.stage !== 'done') {
    return NextResponse.json({ error: 'Ingestion not ready' }, { status: 409 })
  }
  // [S1] Guard against empty extracted text
  if (!job.extracted_text?.trim()) {
    return NextResponse.json({ error: 'Ingestion job has no extracted text' }, { status: 409 })
  }

  // Validate all personas belong to this workspace
  const personas = await Promise.all(persona_ids.map(id => getPersona(id)))
  const invalidPersona = personas.find(p => !p || p.workspace_id !== workspaceId)
  if (invalidPersona !== undefined) {
    return NextResponse.json({ error: 'Invalid persona' }, { status: 403 })
  }

  const [brandConfigs, connectionsByPersona] = await Promise.all([
    Promise.all(persona_ids.map(id => getBrandConfigForPersona(id))),
    Promise.all(persona_ids.map(id => getConnectionsForPersona(id))),
  ])

  const missingBrandIdx = persona_ids.findIndex((_, i) => !brandConfigs[i]?.custom_system_prompt)
  if (missingBrandIdx !== -1) {
    return NextResponse.json(
      { error: 'One or more personas have no voice profile set' }, { status: 409 }
    )
  }

  const campaign = await createCampaign({
    workspace_id: workspaceId,
    ingestion_job_id,
    title: job.extracted_title ?? undefined,
    status: 'generating',
    generation_started_at: new Date().toISOString(),
  })

  const campaignPersonaRows = await createCampaignPersonas(campaign.id, persona_ids)
  const campaignPersonaByPersonaId = Object.fromEntries(
    campaignPersonaRows.map(row => [row.persona_id, row])
  )

  // Fire generation in parallel — one per persona
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

  const allVariants: Array<{
    personaId: string; platform: string; variantId: string; body: string
  }> = []
  let successCount = 0

  for (const result of generationResults) {
    if (result.status === 'rejected') continue

    const { personaId, workerResult, error } = result.value
    const campaignPersona = campaignPersonaByPersonaId[personaId]

    if (error || !workerResult) {
      await supabase
        .from('campaign_personas')
        .update({ generation_error: error ?? 'Generation failed' })
        .eq('id', campaignPersona.id)
      continue
    }

    // [B2] ONE content_item per persona (not per variant/platform)
    const contentItem = await createContentItem({
      workspace_id: workspaceId,
      ingestion_job_id,
      prompt_version_id: brandConfigs[persona_ids.indexOf(personaId)]?.current_prompt_version_id ?? null,
    })

    const postVariants = await createPostVariants(
      workerResult.variants.map(v => ({
        workspace_id: workspaceId,
        content_item_id: contentItem.id,
        platform: v.platform,
        body: v.body,
        status: 'draft' as const,
        persona_id: personaId,
      }))
    )

    // [B1] Link all variants to campaign_persona via join table
    await createCampaignPersonaVariants(
      campaignPersona.id,
      postVariants.map(v => ({ post_variant_id: v.id, platform: v.platform }))
    )

    postVariants.forEach(v => allVariants.push({
      personaId, platform: v.platform, variantId: v.id, body: v.body,
    }))
    successCount++
  }

  // [B8] generation_partial (not partially_approved)
  const finalStatus = successCount === 0
    ? 'failed'
    : successCount < persona_ids.length
    ? 'generation_partial'
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

  const personaMap = Object.fromEntries(
    personas.filter(Boolean).map(p => [p!.id, p!])
  )

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

- [ ] **Step 2: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "api/campaigns"
git add web/app/api/campaigns/route.ts
git commit -m "feat: POST /api/campaigns — parallel per-persona generation with abort signal"
```

---

### Task 12: Campaign approval routes

**Files:**
- Create: `web/app/api/campaigns/[id]/route.ts`
- Create: `web/app/api/campaigns/[id]/approve/route.ts`
- Create: `web/app/api/campaigns/[id]/persona/[persona_id]/approve/route.ts`
- Create: `web/app/api/campaigns/[id]/persona/[persona_id]/reject/route.ts`

- [ ] **Step 1: Create `GET /api/campaigns/[id]`**

```typescript
// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getCampaignWithPersonas } from '@/lib/db/campaigns'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ campaign })
}
```

- [ ] **Step 2: Create `POST /api/campaigns/[id]/approve` (batch approve)**

```typescript
// web/app/api/campaigns/[id]/approve/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import {
  getCampaignWithPersonas, updateCampaignPersonaApproval,
  getVariantsForCampaignPersona, updateCampaign,
} from '@/lib/db/campaigns'
import { insertAuditEvent } from '@/lib/db/audit-events'

const bodySchema = z.object({
  persona_ids: z.array(z.string().uuid()).optional(),  // if absent, approve all pending
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  const targetPersonaIds = parsed.success ? parsed.data.persona_ids : undefined

  const toApprove = campaign.campaign_personas.filter(cp =>
    cp.approval_status === 'pending' &&
    (!targetPersonaIds || targetPersonaIds.includes(cp.persona_id))
  )

  for (const cp of toApprove) {
    await updateCampaignPersonaApproval(cp.id, 'approved')

    // Schedule all variants for this persona
    const variantIds = await getVariantsForCampaignPersona(cp.id)
    if (variantIds.length > 0) {
      await supabase
        .from('post_variants')
        .update({ status: 'scheduled' })
        .in('id', variantIds)
    }

    await insertAuditEvent({
      workspace_id: workspace.workspace_id,
      persona_id: cp.persona_id,
      actor_user_id: user.id,
      event_type: 'campaign_persona.approved',
      entity_type: 'campaign_persona',
      entity_id: cp.id,
    })
  }

  // Check if all personas are now resolved (approved or rejected)
  const updated = await getCampaignWithPersonas(id)
  const allResolved = updated?.campaign_personas.every(
    cp => cp.approval_status !== 'pending'
  )
  if (allResolved) {
    await updateCampaign(id, { status: 'approved' })
  }

  return NextResponse.json({ ok: true, approved_count: toApprove.length })
}
```

- [ ] **Step 3: Create single-persona approve and reject routes**

```typescript
// web/app/api/campaigns/[id]/persona/[persona_id]/approve/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import {
  getCampaignWithPersonas, updateCampaignPersonaApproval,
  getVariantsForCampaignPersona, updateCampaign,
} from '@/lib/db/campaigns'
import { insertAuditEvent } from '@/lib/db/audit-events'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; persona_id: string }> }
) {
  const { id, persona_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cp = campaign.campaign_personas.find(cp => cp.persona_id === persona_id)
  if (!cp) return NextResponse.json({ error: 'Persona not in campaign' }, { status: 404 })

  await updateCampaignPersonaApproval(cp.id, 'approved')

  const variantIds = await getVariantsForCampaignPersona(cp.id)
  if (variantIds.length > 0) {
    await supabase.from('post_variants').update({ status: 'scheduled' }).in('id', variantIds)
  }

  await insertAuditEvent({
    workspace_id: workspace.workspace_id,
    persona_id,
    actor_user_id: user.id,
    event_type: 'campaign_persona.approved',
    entity_type: 'campaign_persona',
    entity_id: cp.id,
  })

  const updated = await getCampaignWithPersonas(id)
  const allResolved = updated?.campaign_personas.every(cp => cp.approval_status !== 'pending')
  if (allResolved) await updateCampaign(id, { status: 'approved' })

  return NextResponse.json({ ok: true })
}
```

```typescript
// web/app/api/campaigns/[id]/persona/[persona_id]/reject/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getCampaignWithPersonas, updateCampaignPersonaApproval, updateCampaign } from '@/lib/db/campaigns'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; persona_id: string }> }
) {
  const { id, persona_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cp = campaign.campaign_personas.find(cp => cp.persona_id === persona_id)
  if (!cp) return NextResponse.json({ error: 'Persona not in campaign' }, { status: 404 })

  // Rejection does NOT delete variants — just marks status
  await updateCampaignPersonaApproval(cp.id, 'rejected')

  const updated = await getCampaignWithPersonas(id)
  const allResolved = updated?.campaign_personas.every(cp => cp.approval_status !== 'pending')
  if (allResolved) await updateCampaign(id, { status: 'approved' })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "api/campaigns"
git add web/app/api/campaigns/
git commit -m "feat: campaign approval routes — batch and per-persona approve/reject"
```

---

## Phase 2.6 — Backward Compat + Cron Updates

### Task 13: Update `POST /api/posts` — campaign side effect

**Files:**
- Modify: `web/app/api/posts/route.ts`

- [ ] **Step 1: Add campaign side-effect to existing POST /api/posts**

After the existing `createPostVariants` call (line ~107), add the campaign side effect. The existing logic is **unchanged** — only these inserts are added:

```typescript
// In web/app/api/posts/route.ts
// After: const variants = await createPostVariants(...)
// Add the following block (before the return statement):

// [B6] Campaign side-effect: make all posts traceable via the campaign model
// This does NOT change any existing behavior — purely additive
let campaignId: string | undefined
try {
  const defaultPersona = await import('@/lib/db/personas').then(m => m.getDefaultPersona(workspaceId))
  if (defaultPersona) {
    const { createCampaign, createCampaignPersonas, createCampaignPersonaVariants } =
      await import('@/lib/db/campaigns')
    const campaign = await createCampaign({
      workspace_id: workspaceId,
      ingestion_job_id,
      title: job.extracted_title ?? undefined,
      status: 'completed',  // single persona, no approval needed
    })
    const [campaignPersonaRow] = await createCampaignPersonas(campaign.id, [defaultPersona.id])
    await createCampaignPersonaVariants(
      campaignPersonaRow.id,
      variants.map(v => ({ post_variant_id: v.id, platform: v.platform }))
    )
    campaignId = campaign.id
  }
} catch {
  // Campaign side-effect must never break the main flow
}
```

Also update the return statement to include `campaign_id`:

```typescript
return NextResponse.json({
  content_item_id: contentItem.id,
  campaign_id: campaignId,  // new optional field — existing callers that ignore unknown fields are unaffected
  variants: variants.map((v) => ({
    id: v.id,
    platform: v.platform,
    body: v.body,
    status: v.status,
  })),
})
```

- [ ] **Step 2: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "api/posts"
git add web/app/api/posts/route.ts
git commit -m "fix: POST /api/posts — add campaign side-effect without changing response shape"
```

---

### Task 14: Update cron — zombie campaign cleanup + persona rate limits

**Files:**
- Modify: `web/app/api/cron/publish-due/route.ts`

- [ ] **Step 1: Read full file**

Read `web/app/api/cron/publish-due/route.ts` to find the exact location to insert.

- [ ] **Step 2: Add zombie campaign cleanup**

Near the top of the `GET` handler (after auth check, before the main variant query), add:

```typescript
// Zombie campaign cleanup: campaigns stuck in 'generating' > 3 minutes → reset to 'failed'
const { data: zombieCampaigns } = await admin
  .from('campaigns')
  .update({ status: 'failed' })
  .eq('status', 'generating')
  .lt('generation_started_at', new Date(Date.now() - 3 * 60 * 1000).toISOString())
  .select('id')

if (zombieCampaigns?.length) {
  await admin
    .from('campaign_personas')
    .update({ approval_status: 'rejected' })
    .eq('approval_status', 'pending')
    .in('campaign_id', zombieCampaigns.map((c: { id: string }) => c.id))
}
```

- [ ] **Step 3: Update `getSocialConnection` call to use persona**

Find the line in `publishVariant` that calls `getSocialConnection(variant.workspace_id, platform)`.

Replace it with a persona-aware lookup: if `variant.persona_id` is set, use `getSocialConnectionForPersona`; otherwise fall back to the workspace lookup:

```typescript
// In publishVariant(), replace the getSocialConnection call:
const connection = variant.persona_id
  ? await getSocialConnectionForPersona(variant.persona_id, platform)
  : await getSocialConnection(variant.workspace_id, platform)
```

Add the import at the top of the file:
```typescript
import { getSocialConnectionForPersona } from '@/lib/db/social-connections'
```

- [ ] **Step 4: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "cron/publish-due"
git add web/app/api/cron/publish-due/route.ts
git commit -m "feat: cron — zombie campaign cleanup and persona-scoped connection lookup"
```

---

## Phase 2.7 — Brand + Voice Routes

### Task 15: Update `/api/brand/config` and `/api/brand/voice-profile`

**Files:**
- Modify: `web/app/api/brand/config/route.ts`
- Modify: `web/app/api/brand/voice-profile/route.ts`

- [ ] **Step 1: Read both files to understand current shape**

```bash
cat web/app/api/brand/config/route.ts
cat web/app/api/brand/voice-profile/route.ts
```

- [ ] **Step 2: Update `brand/config/route.ts`**

Add `persona_id` as an optional field to the request body schema. In the handler, resolve `personaId` before calling `upsertBrandConfig`:

```typescript
// In the Zod schema, add:
persona_id: z.string().uuid().optional(),

// In the handler, after workspace check:
const { getDefaultPersona } = await import('@/lib/db/personas')
const personaId = parsed.data.persona_id ?? (await getDefaultPersona(workspaceId))?.id
if (!personaId) return NextResponse.json({ error: 'No persona found' }, { status: 400 })

// Pass personaId to upsertBrandConfig:
const brandConfig = await upsertBrandConfig({
  workspace_id: workspaceId,
  persona_id: personaId,
  // ...rest of fields unchanged...
})
```

- [ ] **Step 3: Update `brand/voice-profile/route.ts`**

Same pattern: add optional `persona_id` to body schema, resolve to default persona if absent. Pass `persona_id` to any `setVoiceProfile` or `upsertBrandConfig` calls.

- [ ] **Step 4: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "api/brand"
git add web/app/api/brand/config/route.ts web/app/api/brand/voice-profile/route.ts
git commit -m "feat: brand config and voice-profile routes accept optional persona_id"
```

---

## Phase 2.8 — Frontend

### Task 16: Shared settings form components

**Files:**
- Create: `web/components/settings/BrandSettingsForm.tsx`
- Create: `web/components/settings/ConnectionsForm.tsx`
- Modify: `web/app/(app)/settings/brand/page.tsx`
- Modify: `web/app/(app)/settings/connections/page.tsx`

- [ ] **Step 1: Read existing settings pages**

```bash
cat "web/app/(app)/settings/brand/page.tsx"
cat "web/app/(app)/settings/connections/page.tsx"
```

- [ ] **Step 2: Create `BrandSettingsForm.tsx`**

Extract the form JSX from `settings/brand/page.tsx` into a component that accepts `personaId: string`:

```typescript
// web/components/settings/BrandSettingsForm.tsx
'use client'
// Move existing brand form logic here.
// Accept personaId prop.
// Load brand config via GET /api/personas/${personaId} (which includes brand_config summary)
// or directly via the brand config API.
// Save via POST /api/brand/config with persona_id in body.

type Props = { personaId: string }
export function BrandSettingsForm({ personaId }: Props) {
  // ... move existing form state and submission logic here ...
  // Replace hardcoded workspace-level fetch with personaId-scoped fetch
}
```

- [ ] **Step 3: Create `ConnectionsForm.tsx`**

Extract connection display logic from `settings/connections/page.tsx`:

```typescript
// web/components/settings/ConnectionsForm.tsx
'use client'
type Props = { personaId: string }
export function ConnectionsForm({ personaId }: Props) {
  // Shows connected platforms for this persona
  // OAuth links: /api/oauth/linkedin/start?persona_id=${personaId}
  // OAuth links: /api/oauth/x/start?persona_id=${personaId}
  // Load connections via GET /api/personas/${personaId}
}
```

- [ ] **Step 4: Update existing settings pages to use shared components**

```typescript
// web/app/(app)/settings/brand/page.tsx
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getDefaultPersona } from '@/lib/db/personas'
import { BrandSettingsForm } from '@/components/settings/BrandSettingsForm'
import { createClient } from '@/lib/supabase/server'

export default async function BrandSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const defaultPersona = await getDefaultPersona(workspace!.workspace_id)
  return <BrandSettingsForm personaId={defaultPersona!.id} />
}
```

```typescript
// web/app/(app)/settings/connections/page.tsx
// Same pattern — pass defaultPersona.id to <ConnectionsForm personaId={...} />
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "settings"
git add web/components/settings/ web/app/\(app\)/settings/brand/page.tsx web/app/\(app\)/settings/connections/page.tsx
git commit -m "refactor: extract BrandSettingsForm and ConnectionsForm shared components"
```

---

### Task 17: Personas settings pages

**Files:**
- Create: `web/app/(app)/settings/personas/page.tsx`
- Create: `web/app/(app)/settings/personas/new/page.tsx`
- Create: `web/app/(app)/settings/personas/[id]/page.tsx`
- Create: `web/app/(app)/settings/personas/[id]/voice/page.tsx`
- Create: `web/app/(app)/settings/personas/[id]/connections/page.tsx`
- Modify: `web/app/(app)/settings/layout.tsx`
- Modify: `web/components/app/Sidebar.tsx`

- [ ] **Step 1: Update Sidebar nav**

In `web/components/app/Sidebar.tsx`, find the Settings nav entry. Change the `href` to always point to `/settings/personas`:

```typescript
{ name: 'Settings', href: '/settings/personas', icon: SlidersHorizontal },
```

- [ ] **Step 2: Update settings layout — add Personas nav item**

Read `web/app/(app)/settings/layout.tsx`. Add a "Personas" link with a `Users` icon from `lucide-react` to the settings sidebar nav array.

- [ ] **Step 3: Create `/settings/personas/page.tsx` — persona list**

```typescript
// web/app/(app)/settings/personas/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersonasForWorkspace } from '@/lib/db/personas'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

export default async function PersonasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const personas = await getPersonasForWorkspace(workspace!.workspace_id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Personas</h2>
          <p className="text-sm text-muted-foreground">
            Each persona has its own voice, accounts, and posting schedule.
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/personas/new">Add Persona</Link>
        </Button>
      </div>

      <div className="space-y-2">
        {personas.map(persona => (
          <Link
            key={persona.id}
            href={`/settings/personas/${persona.id}`}
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
              style={{ backgroundColor: persona.avatar_color }}
            >
              {persona.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{persona.name}</p>
              {persona.is_default && (
                <p className="text-xs text-muted-foreground">Default</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `/settings/personas/new/page.tsx` — create form**

```typescript
// web/app/(app)/settings/personas/new/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AVATAR_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6']

export default function NewPersonaPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar_color: avatarColor }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      router.push(`/settings/personas/${data.persona.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-lg font-semibold">New Persona</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Company Brand, CEO, Head of Engineering" required maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label>Avatar Color</Label>
          <div className="flex gap-2">
            {AVATAR_COLORS.map(color => (
              <button
                key={color} type="button"
                onClick={() => setAvatarColor(color)}
                className={`w-8 h-8 rounded-full border-2 ${avatarColor === color ? 'border-foreground' : 'border-transparent'}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? 'Creating…' : 'Create Persona'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Create `/settings/personas/[id]/page.tsx` — persona hub**

```typescript
// web/app/(app)/settings/personas/[id]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona } from '@/lib/db/personas'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Mic2, Link2, Clock } from 'lucide-react'

export default async function PersonaHubPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace!.workspace_id) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
          style={{ backgroundColor: persona.avatar_color }}
        >
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-lg font-semibold">{persona.name}</h2>
      </div>

      <div className="grid gap-3">
        <Link href={`/settings/personas/${id}/voice`}
          className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
          <Mic2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Voice Profile</p>
            <p className="text-sm text-muted-foreground">Brand voice and system prompt</p>
          </div>
        </Link>
        <Link href={`/settings/personas/${id}/connections`}
          className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
          <Link2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Connected Accounts</p>
            <p className="text-sm text-muted-foreground">LinkedIn and X connections</p>
          </div>
        </Link>
        <Link href={`/settings/personas/${id}/schedule`}
          className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Posting Schedule</p>
            <p className="text-sm text-muted-foreground">When to post for this persona</p>
          </div>
        </Link>
      </div>

      {!persona.is_default && (
        <DeletePersonaButton personaId={id} />
      )}
    </div>
  )
}

// Client component for delete action — inline to avoid extra file
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline client component
function DeletePersonaButton({ personaId }: { personaId: string }) {
  // Note: this is a Server Component file — export a client subcomponent separately
  // Placeholder: create web/app/(app)/settings/personas/[id]/_components/DeletePersonaButton.tsx
  return null
}
```

Create `web/app/(app)/settings/personas/[id]/_components/DeletePersonaButton.tsx`:

```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function DeletePersonaButton({ personaId }: { personaId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!confirm('Delete this persona? This cannot be undone.')) return
    setLoading(true)
    const res = await fetch(`/api/personas/${personaId}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Delete failed'); setLoading(false); return }
    router.push('/settings/personas')
  }

  return (
    <div className="pt-4 border-t">
      {error && <p className="text-sm text-destructive mb-2">{error}</p>}
      <Button variant="destructive" onClick={handleDelete} disabled={loading}>
        {loading ? 'Deleting…' : 'Delete Persona'}
      </Button>
    </div>
  )
}
```

Update the hub page to import and use `DeletePersonaButton`.

- [ ] **Step 6: Create voice and connections sub-pages**

```typescript
// web/app/(app)/settings/personas/[id]/voice/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona } from '@/lib/db/personas'
import { notFound } from 'next/navigation'
import { BrandSettingsForm } from '@/components/settings/BrandSettingsForm'

export default async function PersonaVoicePage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace!.workspace_id) notFound()
  return <BrandSettingsForm personaId={id} />
}
```

```typescript
// web/app/(app)/settings/personas/[id]/connections/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona } from '@/lib/db/personas'
import { notFound } from 'next/navigation'
import { ConnectionsForm } from '@/components/settings/ConnectionsForm'

export default async function PersonaConnectionsPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const workspace = await getWorkspaceForUser(user!.id)
  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace!.workspace_id) notFound()
  return <ConnectionsForm personaId={id} />
}
```

- [ ] **Step 7: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "settings/personas"
git add web/app/\(app\)/settings/personas/ web/components/app/Sidebar.tsx web/app/\(app\)/settings/layout.tsx
git commit -m "feat: persona settings pages — list, create, hub, voice, connections"
```

---

### Task 18: Chat page — persona selector + campaign flow

**Files:**
- Modify: `web/app/(app)/chat/page.tsx`
- Modify: `web/app/(app)/chat/_components/ExtractionCard.tsx`
- Create: `web/app/(app)/chat/_components/PersonaSelector.tsx`
- Create: `web/app/(app)/chat/_components/CampaignBatchCard.tsx`

- [ ] **Step 1: Read `chat/page.tsx` and `ExtractionCard.tsx`**

```bash
cat "web/app/(app)/chat/page.tsx"
cat "web/app/(app)/chat/_components/ExtractionCard.tsx"
```

- [ ] **Step 2: Create `PersonaSelector.tsx`**

```typescript
// web/app/(app)/chat/_components/PersonaSelector.tsx
import type { Database } from '@/lib/db/types'
type PersonaRow = Database['public']['Tables']['personas']['Row']

type Props = {
  personas: PersonaRow[]
  selectedIds: string[]
  onToggle: (id: string) => void
}

export function PersonaSelector({ personas, selectedIds, onToggle }: Props) {
  if (personas.length <= 1) return null  // only show when there are multiple personas

  return (
    <div className="flex flex-wrap gap-2 py-2">
      <p className="text-xs text-muted-foreground w-full">Generate for:</p>
      {personas.map(persona => {
        const selected = selectedIds.includes(persona.id)
        return (
          <button
            key={persona.id}
            onClick={() => onToggle(persona.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border transition-colors ${
              selected
                ? 'border-transparent text-white'
                : 'border-border text-muted-foreground hover:border-foreground/30'
            }`}
            style={selected ? { backgroundColor: persona.avatar_color } : {}}
          >
            <span className="w-4 h-4 rounded-full text-xs flex items-center justify-center text-white"
              style={{ backgroundColor: persona.avatar_color }}>
              {persona.name.charAt(0).toUpperCase()}
            </span>
            {persona.name}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Update `ExtractionCard.tsx` — add persona selector props**

Add these optional props and render `PersonaSelector` inside the card when `personas?.length > 1`:

```typescript
// Add to ExtractionCard Props type:
personas?: PersonaRow[]
selectedPersonaIds?: string[]
onTogglePersona?: (id: string) => void

// Render inside the card (before the generate button):
{personas && personas.length > 1 && selectedPersonaIds && onTogglePersona && (
  <PersonaSelector
    personas={personas}
    selectedIds={selectedPersonaIds}
    onToggle={onTogglePersona}
  />
)}
```

- [ ] **Step 4: Create `CampaignBatchCard.tsx`**

```typescript
// web/app/(app)/chat/_components/CampaignBatchCard.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CampaignWithPersonas } from '@/lib/db/campaigns'
import { TypingIndicator } from './TypingIndicator'
import { Button } from '@/components/ui/button'

type Props = { campaignId: string }

async function fetchCampaign(campaignId: string): Promise<CampaignWithPersonas | null> {
  const res = await fetch(`/api/campaigns/${campaignId}`)
  if (!res.ok) return null
  const data = await res.json()
  return data.campaign
}

export function CampaignBatchCard({ campaignId }: Props) {
  const [campaign, setCampaign] = useState<CampaignWithPersonas | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  useEffect(() => {
    // [S2] Initial fetch before subscription to avoid blank state
    fetchCampaign(campaignId).then(setCampaign)

    const supabase = createClient()
    const channel = supabase
      .channel(`campaign-${campaignId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'campaign_personas',
        filter: `campaign_id=eq.${campaignId}`,
      }, () => {
        fetchCampaign(campaignId).then(setCampaign)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [campaignId])

  async function approveAll() {
    setApproving('all')
    await fetch(`/api/campaigns/${campaignId}/approve`, { method: 'POST' })
    setCampaign(await fetchCampaign(campaignId))
    setApproving(null)
  }

  async function approvePersona(personaId: string) {
    setApproving(personaId)
    await fetch(`/api/campaigns/${campaignId}/persona/${personaId}/approve`, { method: 'POST' })
    setCampaign(await fetchCampaign(campaignId))
    setApproving(null)
  }

  async function rejectPersona(personaId: string) {
    setApproving(`reject-${personaId}`)
    await fetch(`/api/campaigns/${campaignId}/persona/${personaId}/reject`, { method: 'POST' })
    setCampaign(await fetchCampaign(campaignId))
    setApproving(null)
  }

  if (!campaign) return <TypingIndicator />

  const isGenerating = campaign.status === 'generating'
  const pendingPersonas = campaign.campaign_personas.filter(cp => cp.approval_status === 'pending')

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{campaign.title ?? 'Campaign'}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.campaign_personas.length} persona{campaign.campaign_personas.length !== 1 ? 's' : ''}
          </p>
        </div>
        {pendingPersonas.length > 0 && !isGenerating && (
          <Button size="sm" onClick={approveAll} disabled={approving === 'all'}>
            {approving === 'all' ? 'Approving…' : 'Approve All'}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {campaign.campaign_personas.map(cp => (
          <div key={cp.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: cp.persona.avatar_color }}
                >
                  {cp.persona.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium">{cp.persona.name}</span>
              </div>

              {cp.approval_status === 'pending' && !isGenerating && cp.variants.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => rejectPersona(cp.persona.id)}
                    disabled={approving !== null}
                  >Reject</Button>
                  <Button
                    size="sm"
                    onClick={() => approvePersona(cp.persona.id)}
                    disabled={approving !== null}
                  >
                    {approving === cp.persona.id ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
              )}

              {cp.approval_status === 'approved' && (
                <span className="text-xs text-emerald-600 font-medium">✓ Approved</span>
              )}
              {cp.approval_status === 'rejected' && (
                <span className="text-xs text-muted-foreground">Rejected</span>
              )}
            </div>

            {/* Generating state for this persona */}
            {isGenerating && cp.variants.length === 0 && (
              <TypingIndicator />
            )}

            {/* Variant previews */}
            {cp.variants.map(variant => (
              <div key={variant.id} className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                <span className="font-medium capitalize">{variant.platform}</span>
                {' · '}
                {variant.body.slice(0, 120)}{variant.body.length > 120 ? '…' : ''}
              </div>
            ))}

            {cp.generation_error && (
              <p className="text-xs text-destructive">{cp.generation_error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update `chat/page.tsx` — add persona state and campaign flow**

Read the current `chat/page.tsx` first. Then add:

1. A `personas` state + fetch in `useEffect`:

```typescript
const [personas, setPersonas] = useState<PersonaRow[]>([])
const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([])

useEffect(() => {
  fetch('/api/personas')
    .then(r => r.json())
    .then(data => {
      const list = data.personas ?? []
      setPersonas(list)
      setSelectedPersonaIds(list.map((p: PersonaRow) => p.id))
    })
}, [])

function togglePersona(id: string) {
  setSelectedPersonaIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
}
```

2. Update `handleGenerate` to use `/api/campaigns` when multiple personas selected:

```typescript
// In handleGenerate, replace the POST /api/posts call:
const isMultiPersona = selectedPersonaIds.length > 1

if (isMultiPersona) {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingestion_job_id: jobId,
      persona_ids: selectedPersonaIds,
    }),
  })
  const data = await res.json()
  if (!res.ok) { /* handle error */ return }
  // Add an 'ai-campaign' message type to the chat stream
  addMessage({ type: 'ai-campaign', campaignId: data.campaign_id })
} else {
  // Existing POST /api/posts path — unchanged
}
```

3. Pass persona props to `ExtractionCard`:

```typescript
<ExtractionCard
  // ...existing props...
  personas={personas}
  selectedPersonaIds={selectedPersonaIds}
  onTogglePersona={togglePersona}
/>
```

4. In the message renderer, handle `type === 'ai-campaign'` by rendering `CampaignBatchCard`:

```typescript
{message.type === 'ai-campaign' && (
  <CampaignBatchCard campaignId={message.campaignId} />
)}
```

- [ ] **Step 6: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit 2>&1 | grep "chat"
git add "web/app/(app)/chat/"
git commit -m "feat: chat page — persona selector, campaign generation flow, CampaignBatchCard"
```

---

## Phase 2.9 — Final Wiring + Validation

### Task 19: Update connections/schedule/queue routes to accept `persona_id`

**Files:**
- Modify: `web/app/api/connections/route.ts`
- Modify: `web/app/api/schedule-slots/route.ts`
- Modify: `web/app/api/queue/route.ts`

- [ ] **Step 1: Read each file**

```bash
cat web/app/api/connections/route.ts
cat web/app/api/schedule-slots/route.ts
cat web/app/api/queue/route.ts
```

- [ ] **Step 2: Update each route**

For each: accept optional `?persona_id` query param. If present and valid for this workspace, use `getConnectionsForPersona` / `getSocialConnectionForPersona` instead of the workspace-scoped functions. If absent, fall back to existing behavior (routes through default persona via existing functions — backward compat preserved).

- [ ] **Step 3: TypeScript check + commit**

```bash
cd web && pnpm tsc --noEmit
git add web/app/api/connections/route.ts web/app/api/schedule-slots/route.ts web/app/api/queue/route.ts
git commit -m "feat: connections, schedule-slots, queue routes accept optional persona_id"
```

---

### Task 20: Full integration test pass

- [ ] **Step 1: Run all tests**

```bash
cd web && pnpm vitest run
```
Expected: all existing tests pass. New persona tests pass.

- [ ] **Step 2: Start app + verify existing flow works**

```bash
cd web && pnpm dev
```

Go to `/chat`. Create a post via the existing single-persona flow. Verify:
- Post generates successfully (no regression)
- The `POST /api/posts` response still includes `variants` array
- A campaign row was created as a side effect (check Supabase dashboard → campaigns table)

- [ ] **Step 3: Test persona creation**

Navigate to `/settings/personas`. Click "Add Persona". Create a second persona. Verify it appears in the list.

- [ ] **Step 4: Test persona selector in chat**

Navigate to `/chat` with 2 personas created. Verify `PersonaSelector` appears in `ExtractionCard`. Deselect one persona. Generate content. Verify only the selected persona's campaign fires.

- [ ] **Step 5: Test multi-persona campaign**

Select both personas. Submit a URL. Verify:
- `CampaignBatchCard` appears in the chat stream
- Both persona rows show (with typing indicator while generating)
- After generation, variant previews appear per persona
- "Approve" button appears for each pending persona
- "Approve All" approves both and changes their status to ✓ Approved

- [ ] **Step 6: Test OAuth persona flow**

Go to `/settings/personas/[id]/connections`. Click "Connect LinkedIn". Verify the OAuth callback redirects to `/settings/personas/[id]/connections?linkedin=connected` (not the old `/settings/connections` page).

- [ ] **Step 7: Final TypeScript + build**

```bash
cd web && pnpm tsc --noEmit && pnpm build
```
Expected: no TS errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: phase 2 integration verified — multi-persona campaign flow working"
```

---

## Spec Coverage Checklist (self-review)

| Spec Section | Covered by Task |
|---|---|
| §3.0 Constants file | Task 1 |
| §3.1 set_updated_at trigger | Task 2 |
| §3.2 personas table | Task 2 |
| §3.3 Default persona migration | Task 2 |
| §3.4–3.7 ALTER TABLE existing tables | Task 2 |
| §3.8 campaigns table + status lifecycle | Task 2 |
| §3.9 campaign_personas + campaign_persona_variants [B1, B9] | Task 2 |
| §3.10 audit_events table | Task 2 |
| §3.11 persona_rate_limits + claim_due_variants update [A4, B4] | Task 2 |
| §3.12 bot_sessions table | Task 2 |
| §3.13 RLS policies | Task 2 |
| §3.14 Regenerate TS types | Task 2 |
| §4.1 personas.ts DB helpers [S4] | Task 3 |
| §4.2 campaigns.ts DB helpers [B1] | Task 4 |
| §4.3 audit-events.ts | Task 5 |
| §4.4 persona-rate-limits.ts | Task 5 |
| §4.5 brand-configs.ts update [A2, A9] | Task 6 |
| §4.6 social-connections.ts update | Task 6 |
| §5.1 LinkedIn start route [A1, A10, B5] | Task 7 |
| §5.2 LinkedIn callback route [A1, B5] | Task 7 |
| §5.3 X OAuth [A1, A10, B5] | Task 8 |
| §5.4 Backward compat connections page | Task 7 (handled via fallback) |
| §6.1 POST /api/campaigns [B1, B2, B3, S1] | Tasks 10, 11 |
| §6.2 POST /api/posts backward compat [A14, B6] | Task 13 |
| §6.3 Persona CRUD routes | Task 9 |
| §6.3 Campaign approval routes | Task 12 |
| §6.4 brand/config route [A19] | Task 15 |
| §6.5 voice-profile route [A19] | Task 15 |
| §7.2 workerGenerate signal [B3] | Task 10 |
| §8.1–8.3 Route structure + shared components [A15] | Tasks 16, 17 |
| §8.2 Sidebar Settings href [A17] | Task 17 |
| §8.4 Chat page persona selector | Task 18 |
| §8.5 Campaign flow in ChatPage | Task 18 |
| §8.6 CampaignBatchCard [A16, B7, S2] | Task 18 |
| Zombie campaign cron [A5] | Task 14 |
| Persona-scoped publish connection lookup | Task 14 |
| connections/schedule/queue persona_id param | Task 19 |
