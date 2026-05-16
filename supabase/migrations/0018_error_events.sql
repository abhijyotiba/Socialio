-- Operational hardening — capture client and server errors
--
-- Lightweight error tracking that lives entirely inside Supabase. The
-- web app's error boundaries POST to /api/log-error which inserts into
-- this table; server routes call logError() from lib/observability.
--
-- Sentry-proper is the natural follow-up. This table is intentionally
-- minimal so swapping in Sentry later is a search-and-replace, not a
-- schema migration.

CREATE TABLE public.error_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 'server' for API route errors, 'client' for React/runtime errors
  source        TEXT NOT NULL CHECK (source IN ('server', 'client')),
  -- Identifier for the failing surface — route path, component name, etc.
  origin        TEXT,
  -- Short message — the .message of the Error
  message       TEXT NOT NULL,
  -- Truncated stack (first ~4KB) — full stacks balloon the table fast
  stack         TEXT,
  -- Free-form attachment: digest, status code, IDs in scope, etc.
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX error_events_created_idx ON public.error_events(created_at DESC);
CREATE INDEX error_events_workspace_created_idx
  ON public.error_events(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

-- Writes go through the service-role client only (the log-error route uses
-- the admin client). No PostgREST surface for reading: errors are an
-- operator concern, not a user concern.
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
-- No policies defined — RLS-on + no-policies means user clients cannot
-- read or write, only service_role can. This matches audit_events for
-- writes but is stricter on reads.
