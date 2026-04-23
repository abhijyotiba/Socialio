-- Add prompt provenance to post variants for per-variant traceability
ALTER TABLE public.post_variants
  ADD COLUMN prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_post_variants_prompt_version
  ON public.post_variants(prompt_version_id);