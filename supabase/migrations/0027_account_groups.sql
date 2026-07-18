-- Task 7 — account groups
--
-- Lets an operator organize personas (social accounts) into named groups so a
-- campaign can target "all of Group X" instead of hand-picking 50 personas.
-- Both tables are workspace-isolated via RLS (same pattern as content_cadences
-- in 0021). Writes go through the worker (service role bypasses RLS); user
-- clients get read + mutate policies scoped to their workspace, consistent with
-- other workspace-owned tables the UI manages directly-ish (kept symmetric with
-- posting_schedules so the settings UI can read freely).

-- ---------------------------------------------------------------------------
-- 1. persona_groups — a named collection of personas within a workspace
-- ---------------------------------------------------------------------------
CREATE TABLE public.persona_groups (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX idx_persona_groups_workspace ON public.persona_groups (workspace_id);

ALTER TABLE public.persona_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persona_groups_member_select"
  ON public.persona_groups FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "persona_groups_member_insert"
  ON public.persona_groups FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "persona_groups_member_update"
  ON public.persona_groups FOR UPDATE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "persona_groups_member_delete"
  ON public.persona_groups FOR DELETE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- 2. persona_group_members — membership join (a persona can be in many groups)
-- ---------------------------------------------------------------------------
CREATE TABLE public.persona_group_members (
  group_id    UUID NOT NULL REFERENCES public.persona_groups(id) ON DELETE CASCADE,
  persona_id  UUID NOT NULL REFERENCES public.personas(id)       ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, persona_id)
);

CREATE INDEX idx_persona_group_members_persona ON public.persona_group_members (persona_id);

ALTER TABLE public.persona_group_members ENABLE ROW LEVEL SECURITY;

-- Membership visibility follows the group's workspace.
CREATE POLICY "persona_group_members_member_select"
  ON public.persona_group_members FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM public.persona_groups
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );
CREATE POLICY "persona_group_members_member_insert"
  ON public.persona_group_members FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT id FROM public.persona_groups
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
    AND persona_id IN (
      SELECT id FROM public.personas
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );
CREATE POLICY "persona_group_members_member_delete"
  ON public.persona_group_members FOR DELETE
  USING (
    group_id IN (
      SELECT id FROM public.persona_groups
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

NOTIFY pgrst, 'reload schema';
