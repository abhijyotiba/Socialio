-- Phase 4: publish pipeline

-- publish_attempts: audit log and idempotency guard for every publish attempt.
CREATE TABLE public.publish_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_variant_id   UUID NOT NULL REFERENCES public.post_variants(id) ON DELETE CASCADE,
  idempotency_key   TEXT NOT NULL,        -- = post_variant_id; sent to platform where supported
  attempt_number    INT  NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'attempting'
                    CHECK (status IN ('attempting', 'success', 'failed')),
  platform_post_id  TEXT,                 -- returned by platform on success
  platform_post_url TEXT,                 -- direct link to the published post
  error_code        TEXT,                 -- machine-readable: TOKEN_EXPIRED, RATE_LIMITED,
                                          --   CONTENT_POLICY, INVALID_MEDIA, SERVER_ERROR, UNKNOWN
  error_detail      TEXT,                 -- raw error message for debugging
  attempted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  CONSTRAINT publish_attempts_idempotency_unique UNIQUE (idempotency_key, attempt_number)
);

ALTER TABLE public.publish_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_attempts_member_select" ON public.publish_attempts
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "publish_attempts_member_insert" ON public.publish_attempts
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "publish_attempts_member_update" ON public.publish_attempts
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_publish_attempts_variant     ON public.publish_attempts(post_variant_id);
CREATE INDEX idx_publish_attempts_workspace   ON public.publish_attempts(workspace_id);
CREATE INDEX idx_publish_attempts_idempotency ON public.publish_attempts(idempotency_key);

-- Add platform-level result columns to post_variants.
-- published_at already exists; platform_post_id, platform_post_url, error_code are new.
ALTER TABLE public.post_variants
  ADD COLUMN IF NOT EXISTS platform_post_id  TEXT,
  ADD COLUMN IF NOT EXISTS platform_post_url TEXT,
  ADD COLUMN IF NOT EXISTS error_code        TEXT;
