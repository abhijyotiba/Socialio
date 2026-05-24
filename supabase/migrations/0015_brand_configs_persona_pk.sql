-- ── 0015 (second): campaigns failure + variant prompt snapshot ──────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS failure_code   TEXT;

ALTER TABLE public.campaign_persona_variants
  ADD COLUMN IF NOT EXISTS prompt_version_id UUID
    REFERENCES public.prompt_versions(id);

CREATE INDEX IF NOT EXISTS campaign_persona_variants_prompt_version_id_idx
  ON public.campaign_persona_variants(prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;

-- ── 0016: platform_limits table + claim_due_variants refactor ──────────────
CREATE TABLE IF NOT EXISTS public.platform_limits (
  platform         TEXT PRIMARY KEY,
  daily_post_limit INTEGER NOT NULL CHECK (daily_post_limit > 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platform_limits (platform, daily_post_limit) VALUES
  ('linkedin', 20),
  ('x',        50)
ON CONFLICT (platform) DO NOTHING;

ALTER TABLE public.platform_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_limits_read_all ON public.platform_limits;
CREATE POLICY platform_limits_read_all ON public.platform_limits
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.claim_due_variants(
  p_worker_id TEXT,
  p_limit     INT DEFAULT 10
)
RETURNS SETOF public.post_variants
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.post_variants
  SET status = 'publishing', claimed_at = now(), worker_id = p_worker_id
  WHERE id IN (
    SELECT pv.id
    FROM   public.post_variants pv
    LEFT JOIN public.platform_limits pl ON pl.platform = pv.platform
    WHERE  pv.status = 'scheduled'
      AND  pv.scheduled_at <= now()
      AND (
        pv.persona_id IS NULL
        OR pl.daily_post_limit IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.persona_rate_limits prl
          WHERE prl.persona_id = pv.persona_id
            AND prl.platform   = pv.platform
            AND prl.day_reset_at = CURRENT_DATE
            AND prl.posts_today >= pl.daily_post_limit
        )
      )
    ORDER  BY pv.scheduled_at
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_due_variants(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_due_variants(TEXT, INT) TO service_role;

-- ── 0017: backfill post_variants.persona_id from workspace default ─────────
UPDATE public.post_variants pv
SET persona_id = p.id
FROM public.content_items ci
JOIN public.personas p
  ON p.workspace_id = ci.workspace_id AND p.is_default = true
WHERE pv.content_item_id = ci.id
  AND pv.persona_id IS NULL;

-- ── 0018: error_events table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('server', 'client')),
  origin        TEXT,
  message       TEXT NOT NULL,
  stack         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_events_created_idx
  ON public.error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS error_events_workspace_created_idx
  ON public.error_events(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

-- ── 0019: campaigns.user_angle ─────────────────────────────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS user_angle TEXT;

-- ── Force PostgREST to pick up the new schema immediately ──────────────────
NOTIFY pgrst, 'reload schema';
