-- T2.2 + T2.3 — Forbidden-phrase enforcement + URL-hash ingestion cache
--
-- 1. forbidden_phrases TEXT[] on brand_configs (specified in PRD §8.2, never added)
-- 2. warning + forbidden_matches on post_variants for advisory phrase flagging
-- 3. ingestion_cache table to skip re-scraping identical URLs within 7 days

-- ── 1. Forbidden phrases on brand configs ────────────────────────────────────
ALTER TABLE public.brand_configs
  ADD COLUMN IF NOT EXISTS forbidden_phrases TEXT[] DEFAULT '{}';

-- ── 2. Warning fields on post_variants ───────────────────────────────────────
-- Advisory only — a post with forbidden matches is flagged but never blocked.
-- The UI highlights matches in yellow so the user can review and override.
ALTER TABLE public.post_variants
  ADD COLUMN IF NOT EXISTS warning TEXT,
  ADD COLUMN IF NOT EXISTS forbidden_matches JSONB;

-- ── 3. URL-hash ingestion cache ──────────────────────────────────────────────
-- Hash of the source URL (sha256) is the cache key. 7-day TTL avoids re-scraping
-- the same page and wasting Firecrawl quota + Cloudinary storage.
CREATE TABLE IF NOT EXISTS public.ingestion_cache (
  url_hash        TEXT PRIMARY KEY,
  source_url      TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  extracted_title TEXT,
  extracted_text  TEXT,
  media_assets    JSONB DEFAULT '[]',
  cached_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_cache_cached_at
  ON public.ingestion_cache (cached_at);

-- RLS: workspace-scoped reads/writes via the standard helper.
ALTER TABLE public.ingestion_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingestion_cache_workspace_select ON public.ingestion_cache
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY ingestion_cache_workspace_insert ON public.ingestion_cache
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

NOTIFY pgrst, 'reload schema';
