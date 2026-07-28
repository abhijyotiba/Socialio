-- T3.2 — LLM cost tracking
--
-- Records every LLM call with its provider, model, token counts, and cost
-- so the operator can monitor per-workspace spend and identify heavy users.

CREATE TABLE IF NOT EXISTS public.llm_usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,             -- 'groq' or 'gemini'
  model          TEXT NOT NULL,             -- e.g. 'llama-3.3-70b-versatile'
  call_type      TEXT NOT NULL,             -- 'atomize', 'generate', 'summarize', 'regenerate', 'voice_profile'
  prompt_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  output_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd       DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  duration_ms    INTEGER,                  -- wall-clock duration of the API call
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_workspace_created
  ON public.llm_usage (workspace_id, created_at DESC);

-- RLS: workspace-scoped reads only.
ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY llm_usage_workspace_select ON public.llm_usage
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

NOTIFY pgrst, 'reload schema';
