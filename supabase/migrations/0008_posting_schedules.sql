-- Phase 5: Posting Schedules
-- User-configured preferred posting time slots per workspace × platform

CREATE TABLE IF NOT EXISTS public.posting_schedules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform      TEXT        NOT NULL CHECK (platform IN ('linkedin', 'x')),
  hour          INT         NOT NULL CHECK (hour >= 0 AND hour <= 23),
  minute        INT         NOT NULL CHECK (minute IN (0, 30)),
  days_of_week  INT[]       NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  timezone      TEXT        NOT NULL DEFAULT 'UTC',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, hour, minute, timezone)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posting_schedules_workspace ON public.posting_schedules (workspace_id);
CREATE INDEX IF NOT EXISTS idx_posting_schedules_platform  ON public.posting_schedules (workspace_id, platform);

-- RLS
ALTER TABLE public.posting_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posting_schedules_member_select"
  ON public.posting_schedules FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "posting_schedules_member_insert"
  ON public.posting_schedules FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "posting_schedules_member_update"
  ON public.posting_schedules FOR UPDATE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "posting_schedules_member_delete"
  ON public.posting_schedules FOR DELETE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
