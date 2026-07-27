-- T1.2 + T1.4 — Email notifications support + low_reservoir notification kind
--
-- 1. Extend notifications.kind CHECK to include low_reservoir and
--    campaign_generated (future-proofing for the autopilot lifecycle).
-- 2. Add notification_preferences JSONB to workspaces so users can opt out
--    of email per-category without touching the in-app notification stream.

-- ── 1. Extend notification kinds ─────────────────────────────────────────────
-- The CHECK constraint is named 'notifications_kind_check' from migration 0025.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'publish_failed', 'needs_reauth', 'campaign_failed',
    'low_reservoir', 'campaign_generated'
  ));

-- ── 2. Workspace notification preferences ────────────────────────────────────
-- JSONB column keyed by notification kind → boolean (true = email enabled).
-- Default {} means no emails sent until the user opts in via settings.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
