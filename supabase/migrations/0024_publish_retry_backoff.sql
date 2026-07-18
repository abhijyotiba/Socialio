-- Task 4 — Scheduling reliability: retry/backoff + live rate-limit counter
--
-- This migration makes the publish-due path resilient to transient platform
-- failures (429 rate-limit, 5xx server error) by adding a bounded retry/backoff
-- schedule directly on post_variants, and fixes the dead persona_rate_limits
-- counter (nothing ever wrote posts_today, so the daily-cap guard in
-- claim_due_variants never actually fired).
--
-- 1. post_variants gains retry_count + next_retry_at.
-- 2. The status CHECK gains 'failed_terminal' (a retry-exhausted or
--    non-retryable failure — distinct from 'failed', which is "will retry").
-- 3. A partial index supports the retry-due lookup.
-- 4. claim_due_variants (v4) also re-claims 'failed' rows whose next_retry_at
--    has arrived, ordered by COALESCE(next_retry_at, scheduled_at).
-- 5. increment_persona_rate_limit(persona_id, platform) upserts posts_today
--    with a per-day reset — called by the worker on every successful publish.

-- ── 1. Retry bookkeeping columns ─────────────────────────────────────────────
ALTER TABLE public.post_variants
  ADD COLUMN retry_count  INT DEFAULT 0,
  ADD COLUMN next_retry_at TIMESTAMPTZ;

-- ── 2. Extend the status CHECK with 'failed_terminal' ────────────────────────
-- The CHECK on post_variants.status is inline/system-named (from 0004), so we
-- look up the real constraint name via pg_constraint (contype='c' referencing
-- the status column), drop it, and re-add with the full status list plus
-- 'failed_terminal'.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname
    INTO con_name
    FROM pg_constraint c
    JOIN pg_class      rel ON rel.oid = c.conrelid
    JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
    JOIN pg_attribute  att ON att.attrelid = c.conrelid
                          AND att.attnum = ANY (c.conkey)
   WHERE ns.nspname  = 'public'
     AND rel.relname = 'post_variants'
     AND c.contype   = 'c'
     AND att.attname = 'status'
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.post_variants DROP CONSTRAINT %I', con_name
    );
  END IF;

  ALTER TABLE public.post_variants
    ADD CONSTRAINT post_variants_status_check
    CHECK (status IN (
      'draft', 'scheduled', 'publishing', 'published',
      'failed', 'failed_terminal', 'cancelled'
    ));
END $$;

-- ── 3. Retry-due partial index ───────────────────────────────────────────────
CREATE INDEX idx_post_variants_next_retry
  ON public.post_variants (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- ── 4. claim_due_variants v4 — also re-claim retryable failures ──────────────
-- Same daily-cap guard (JOIN platform_limits) and FOR UPDATE SKIP LOCKED as the
-- 0016 version, but the WHERE now matches BOTH scheduled-and-due variants AND
-- failed variants whose next_retry_at has passed. Ordering by
-- COALESCE(next_retry_at, scheduled_at) drains overdue retries and schedules in
-- one queue. SECURITY DEFINER + service_role-only, unchanged.
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
    WHERE  (
             (pv.status = 'scheduled' AND pv.scheduled_at <= now())
             OR (pv.status = 'failed'
                 AND pv.next_retry_at IS NOT NULL
                 AND pv.next_retry_at <= now())
           )
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
    ORDER  BY COALESCE(pv.next_retry_at, pv.scheduled_at)
    LIMIT  p_limit
    -- FOR UPDATE OF pv (not a bare FOR UPDATE): platform_limits is the nullable
    -- side of the LEFT JOIN, and Postgres rejects row locks on an outer join's
    -- nullable side. We only need to lock the post_variants rows we claim.
    FOR UPDATE OF pv SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_due_variants(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_due_variants(TEXT, INT) TO service_role;

-- ── 5. increment_persona_rate_limit — the live daily counter ─────────────────
-- Upsert the per-(persona, platform) row: if the stored day_reset_at is today,
-- bump posts_today; otherwise reset it to 1 and roll day_reset_at to today.
-- This is what makes the daily-cap guard in claim_due_variants real — before
-- this, posts_today was never incremented so the cap never triggered.
CREATE OR REPLACE FUNCTION public.increment_persona_rate_limit(
  p_persona_id UUID,
  p_platform   TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.persona_rate_limits
    (persona_id, platform, posts_today, last_post_at, day_reset_at)
  VALUES
    (p_persona_id, p_platform, 1, now(), CURRENT_DATE)
  ON CONFLICT (persona_id, platform) DO UPDATE
  SET
    posts_today = CASE
      WHEN public.persona_rate_limits.day_reset_at = CURRENT_DATE
      THEN public.persona_rate_limits.posts_today + 1
      ELSE 1
    END,
    day_reset_at = CURRENT_DATE,
    last_post_at = now();
$$;

REVOKE ALL ON FUNCTION public.increment_persona_rate_limit(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_persona_rate_limit(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
