-- Unify autopilot review into campaigns: distinguish manual vs autopilot campaigns.
-- Manual = the existing ingest→generate→per-persona-approve flow (default, unchanged).
-- Autopilot = one campaign per atomized asset, filled by the refill cron, reviewed per-post.

ALTER TABLE public.campaigns
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'
  CHECK (kind IN ('manual', 'autopilot'));

-- Find the autopilot campaign for an asset quickly (atomize find-or-create + cron link).
CREATE INDEX idx_campaigns_autopilot_job
  ON public.campaigns (ingestion_job_id)
  WHERE kind = 'autopilot';
  