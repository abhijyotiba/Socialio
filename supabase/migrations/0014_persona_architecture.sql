-- Phase 2.1: Multi-Persona Architecture
-- Adds personas table + campaign tables + persona_id FK to existing tables

-- ── 0. set_updated_at trigger function (already exists from 0004, replace to be idempotent) ──
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
-- brand_configs uses workspace_id as PRIMARY KEY; no separate unique constraint to drop.
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
-- Drop the old workspace+platform unique constraint (named in 0002_brand_and_connections.sql)
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_workspace_platform_unique;
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
-- [B4] KEEP IN SYNC WITH PLATFORM_DAILY_LIMITS in web/lib/constants/platforms.ts
CREATE OR REPLACE FUNCTION public.claim_due_variants(
  p_worker_id TEXT,
  p_limit     INT DEFAULT 10
)
RETURNS SETOF public.post_variants
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.post_variants
  SET
    status     = 'publishing',
    claimed_at = now(),
    worker_id  = p_worker_id
  WHERE id IN (
    SELECT id
    FROM   public.post_variants
    WHERE  status = 'scheduled'
      AND  scheduled_at <= now()
      AND (
        persona_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM persona_rate_limits prl
          WHERE prl.persona_id = post_variants.persona_id
            AND prl.platform = post_variants.platform
            AND prl.day_reset_at = CURRENT_DATE
            AND prl.posts_today >= (
              CASE post_variants.platform
                WHEN 'linkedin' THEN 20
                WHEN 'x' THEN 50
                ELSE 999
              END
            )
        )
      )
    ORDER  BY scheduled_at
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_due_variants(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_due_variants(TEXT, INT) TO service_role;
