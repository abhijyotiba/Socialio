-- Phase 5: Cron helper functions
-- claim_due_variants: atomically claims up to p_limit scheduled variants whose
-- scheduled_at is now due.  Uses FOR UPDATE SKIP LOCKED so concurrent cron
-- invocations never double-claim the same row.
-- SECURITY DEFINER + service_role-only grant matches the pattern used for vault helpers.

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
    ORDER  BY scheduled_at
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_due_variants(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_due_variants(TEXT, INT) TO service_role;
