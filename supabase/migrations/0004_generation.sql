-- Phase 3: generation pipeline tables

-- content_items: one row per "generate" action. Links ingestion → variants.
CREATE TABLE public.content_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ingestion_job_id  UUID REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL,
  prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  summary           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_items_member_select" ON public.content_items
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "content_items_member_insert" ON public.content_items
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "content_items_member_update" ON public.content_items
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_content_items_workspace ON public.content_items(workspace_id);
CREATE INDEX idx_content_items_job       ON public.content_items(ingestion_job_id);

-- post_variants: one row per platform per content_item. Has its own status machine.
CREATE TABLE public.post_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id  UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  claimed_at       TIMESTAMPTZ,
  worker_id        TEXT,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_variants_member_select" ON public.post_variants
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_variants_member_insert" ON public.post_variants
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_variants_member_update" ON public.post_variants
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_post_variants_workspace     ON public.post_variants(workspace_id);
CREATE INDEX idx_post_variants_content_item  ON public.post_variants(content_item_id);
CREATE INDEX idx_post_variants_status        ON public.post_variants(status);
CREATE INDEX idx_post_variants_scheduled     ON public.post_variants(scheduled_at)
  WHERE status = 'scheduled';

-- updated_at trigger for post_variants
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_post_variants_updated_at
  BEFORE UPDATE ON public.post_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
