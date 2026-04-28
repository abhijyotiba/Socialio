-- Phase 7 — Voice & Refinement
-- Append-only revision log for post_variants. Every regeneration snapshots the
-- prior body so users can revert. The current body still lives on post_variants;
-- this table is history.

CREATE TABLE public.post_variant_revisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_variant_id  UUID NOT NULL REFERENCES public.post_variants(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id)    ON DELETE CASCADE,
  revision_number  INT  NOT NULL,
  body             TEXT NOT NULL,
  instruction      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_variant_id, revision_number)
);

COMMENT ON TABLE public.post_variant_revisions IS
  'Append-only history of post_variant.body. Inserted before each regeneration. '
  'instruction is NULL for the initial generation snapshot, otherwise contains '
  'the user-provided regeneration instruction.';

ALTER TABLE public.post_variant_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_variant_revisions_member_select"
  ON public.post_variant_revisions
  FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_variant_revisions_member_insert"
  ON public.post_variant_revisions
  FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

-- No update or delete policies — this table is append-only.

CREATE INDEX idx_post_variant_revisions_variant
  ON public.post_variant_revisions(post_variant_id, revision_number DESC);
