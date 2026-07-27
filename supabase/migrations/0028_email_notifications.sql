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

-- ── 3. RPC: lookup workspace owner's email ────────────────────────────────────
-- Service-role only. Queries auth.users directly (requires the supabase_admin
-- role or a SECURITY DEFINER function owned by a role with auth schema access).
-- Used by the email adapter to send notifications to the workspace owner.
CREATE OR REPLACE FUNCTION public.get_workspace_owner_email(
  p_workspace_id UUID
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.email
  FROM   workspace_members wm
  JOIN   auth.users u ON u.id = wm.user_id
  WHERE  wm.workspace_id = p_workspace_id
    AND  wm.role = 'owner'
  LIMIT  1;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_owner_email(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_workspace_owner_email(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
