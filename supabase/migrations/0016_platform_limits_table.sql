-- Phase V2.2 Step D — platform_limits as the single source of truth
--
-- Previously the daily post limits lived in TWO places:
--   - web/lib/constants/platforms.ts (PLATFORM_DAILY_LIMITS)
--   - claim_due_variants RPC (hardcoded CASE in 0014)
-- Drift between them was a known footgun. This migration introduces a
-- platform_limits table and refactors the RPC to JOIN it. The TS constants
-- still exist (for client-side validation and zod enums), but a CI test
-- asserts they match the seeded values here.

CREATE TABLE public.platform_limits (
  platform         TEXT PRIMARY KEY,
  daily_post_limit INTEGER NOT NULL CHECK (daily_post_limit > 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platform_limits (platform, daily_post_limit) VALUES
  ('linkedin', 20),
  ('x',        50);

-- Read-only from the public PostgREST surface. Writes go through migrations.
ALTER TABLE public.platform_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_limits_read_all ON public.platform_limits
  FOR SELECT USING (true);

-- ── Refactor claim_due_variants to JOIN platform_limits ──────────────────────
-- Same semantics as 0014's version, but the limit is sourced from the table
-- instead of a hardcoded CASE.

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
