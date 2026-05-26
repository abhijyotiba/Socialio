-- Add composite indexes to speed up sorting and filtering under RLS workspace context
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_created
  ON public.campaigns (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_variants_workspace_status_published
  ON public.post_variants (workspace_id, status, published_at DESC);
