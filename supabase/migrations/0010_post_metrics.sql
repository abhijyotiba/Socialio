-- Phase 6: post metrics

CREATE TABLE public.post_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_variant_id UUID NOT NULL UNIQUE REFERENCES public.post_variants(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  impressions     INT,
  likes           INT,
  comments        INT,
  shares          INT,
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_metrics_member_select" ON public.post_metrics
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_metrics_member_insert" ON public.post_metrics
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_metrics_member_update" ON public.post_metrics
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_metrics_member_delete" ON public.post_metrics
  FOR DELETE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_post_metrics_workspace ON public.post_metrics(workspace_id);
CREATE INDEX idx_post_metrics_variant ON public.post_metrics(post_variant_id);
