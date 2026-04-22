-- Phase 2: ingestion pipeline tables

CREATE TABLE public.ingestion_jobs (
	id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	source_type      TEXT NOT NULL CHECK (source_type IN ('url', 'text', 'mcp')),
	source_url       TEXT,
	source_text      TEXT,
	extracted_title  TEXT,
	extracted_text   TEXT,
	-- stage: the most recently completed pipeline step.
	-- web route writes 'pending'; advances through scraping/uploading_media;
	-- web route writes 'done' or 'failed' after the worker returns.
	stage            TEXT NOT NULL DEFAULT 'pending'
	                 CHECK (stage IN ('pending','scraping','uploading_media',
	                                  'analyzing','generating','storing','done','failed')),
	error            TEXT,
	created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
	completed_at     TIMESTAMPTZ
);

ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingestion_jobs_member_select" ON public.ingestion_jobs
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "ingestion_jobs_member_insert" ON public.ingestion_jobs
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "ingestion_jobs_member_update" ON public.ingestion_jobs
	FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE TABLE public.media_assets (
	id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	ingestion_job_id UUID REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL,
	cloudinary_url   TEXT NOT NULL,
	cloudinary_id    TEXT NOT NULL,
	resource_type    TEXT NOT NULL CHECK (resource_type IN ('image', 'video')),
	format           TEXT,
	bytes            BIGINT,
	width            INT,
	height           INT,
	created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_assets_member_select" ON public.media_assets
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "media_assets_member_insert" ON public.media_assets
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_ingestion_jobs_workspace ON public.ingestion_jobs(workspace_id);
CREATE INDEX idx_ingestion_jobs_stage     ON public.ingestion_jobs(stage);
CREATE INDEX idx_ingestion_jobs_created   ON public.ingestion_jobs(created_at DESC);
CREATE INDEX idx_media_assets_job         ON public.media_assets(ingestion_job_id);
CREATE INDEX idx_media_assets_workspace   ON public.media_assets(workspace_id);
