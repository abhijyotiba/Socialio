-- Autonomous Content Engine
--
-- Adds the atomization matrix + reservoir/cadence layer on top of the
-- existing campaign pipeline. See
-- docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md
--
-- Three changes:
--   1. content_ideas    — atomic ideas mined from one asset (ingestion_job)
--   2. content_cadences — per-persona+platform "set it once" config
--   3. content_items    — gains matrix-cell columns + a status

-- ---------------------------------------------------------------------------
-- 1. content_ideas — the raw material the matrix multiplies
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_ideas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ingestion_job_id  UUID NOT NULL REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  essence           TEXT NOT NULL,
  idea_type         TEXT NOT NULL CHECK (idea_type IN ('stat','story','claim','framework','lesson')),
  source_quote      TEXT NOT NULL,
  strength          INT  NOT NULL DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
  suitable_formats  JSONB NOT NULL DEFAULT '[]',
  suitable_angles   JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_ideas_workspace ON public.content_ideas (workspace_id);
CREATE INDEX idx_content_ideas_job       ON public.content_ideas (ingestion_job_id);

ALTER TABLE public.content_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_ideas_member_select"
  ON public.content_ideas FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
-- Writes are worker-only (service role bypasses RLS). No insert/update/delete
-- policies → user clients can read their ideas but never mutate them.

-- ---------------------------------------------------------------------------
-- 2. content_cadences — the "set it once" config (one row per persona+platform)
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_cadences (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id               UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  platform                 TEXT NOT NULL CHECK (platform IN ('linkedin','x')),
  posts_per_week           INT  NOT NULL DEFAULT 3 CHECK (posts_per_week BETWEEN 1 AND 21),
  autopilot_enabled        BOOLEAN NOT NULL DEFAULT false,
  active                   BOOLEAN NOT NULL DEFAULT true,
  low_reservoir_threshold  INT  NOT NULL DEFAULT 5 CHECK (low_reservoir_threshold >= 0),
  last_low_nudge_at        TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, platform)
);

CREATE INDEX idx_content_cadences_workspace ON public.content_cadences (workspace_id);
CREATE INDEX idx_content_cadences_active    ON public.content_cadences (active) WHERE active = true;

ALTER TABLE public.content_cadences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_cadences_member_select"
  ON public.content_cadences FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_insert"
  ON public.content_cadences FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_update"
  ON public.content_cadences FOR UPDATE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_delete"
  ON public.content_cadences FOR DELETE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- 3. content_items — matrix-cell columns. All nullable so legacy rows (created
--    by the existing one-shot pipeline) remain valid; only engine rows set them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_items
  ADD COLUMN idea_id          UUID REFERENCES public.content_ideas(id) ON DELETE CASCADE,
  ADD COLUMN persona_id       UUID REFERENCES public.personas(id) ON DELETE CASCADE,
  ADD COLUMN format           TEXT CHECK (format IN ('hot_take','how_to','personal_story','question','myth_buster','thread')),
  ADD COLUMN angle            TEXT CHECK (angle IN ('beginner','expert','contrarian','practical')),
  ADD COLUMN platform         TEXT CHECK (platform IN ('linkedin','x')),
  ADD COLUMN status           TEXT,
  ADD COLUMN matrix_cell_hash TEXT;

-- The dedup guarantee: a given (idea, format, angle, platform) cell can exist
-- at most once. Partial unique index so legacy NULL-hash rows are exempt.
CREATE UNIQUE INDEX uq_content_items_matrix_cell
  ON public.content_items (matrix_cell_hash)
  WHERE matrix_cell_hash IS NOT NULL;

-- Reservoir queries select planned/rendered cells for a persona+platform.
CREATE INDEX idx_content_items_reservoir
  ON public.content_items (persona_id, platform, status)
  WHERE status IS NOT NULL;
