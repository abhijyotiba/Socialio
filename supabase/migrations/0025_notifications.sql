-- Task 4 — in-app notifications table
--
-- Backs the in-app alerting surface (Task 10's banner reads unread rows here).
-- Every reliability signal that used to be invisible — a publish that exhausted
-- its retries, a connection flagged needs_reauth, a campaign that failed to
-- generate — inserts a row here so the user actually sees it. The worker owns
-- all writes (service-role on the cron paths, RLS on the mark-read route);
-- reads go through RLS-scoped web/lib/db.

CREATE TABLE public.notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id   UUID REFERENCES public.personas(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL
               CHECK (kind IN ('publish_failed', 'needs_reauth', 'campaign_failed')),
  title        TEXT NOT NULL,
  body         TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unread-first, newest-first listing per workspace (the banner query).
CREATE INDEX idx_notifications_workspace_created
  ON public.notifications (workspace_id, created_at DESC);

-- Workspace-isolation RLS via the standard user_workspace_ids() helper.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_workspace_select ON public.notifications
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY notifications_workspace_update ON public.notifications
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY notifications_workspace_insert ON public.notifications
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

NOTIFY pgrst, 'reload schema';
