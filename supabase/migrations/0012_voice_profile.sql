-- Phase 7 — Voice & Refinement
-- Adds voice profile storage to brand_configs and a source label to prompt_versions
-- so we can distinguish prompts generated from a voice profile vs. hand-written.

-- 1. brand_configs: store the structured voice profile JSON.
ALTER TABLE public.brand_configs
  ADD COLUMN voice_profile JSONB,
  ADD COLUMN voice_profile_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.brand_configs.voice_profile IS
  'Structured voice analysis (length, structure, tone, openers, closers, topics). '
  'Schema-of-record lives in worker/pipeline/voice_profile.py:VoiceProfile. '
  'Re-derived from user-pasted samples via POST /api/brand/voice-profile.';

-- 2. prompt_versions: record where each version came from.
--    'manual'                — user wrote/edited the prompt themselves.
--    'voice_profile'         — system rendered from a voice_profile JSON.
--    'voice_profile_edited'  — started as voice_profile, user has since edited.
ALTER TABLE public.prompt_versions
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'voice_profile', 'voice_profile_edited'));

COMMENT ON COLUMN public.prompt_versions.source IS
  'Provenance of the prompt text: manual (hand-written), voice_profile (rendered from JSON), '
  'or voice_profile_edited (rendered then edited).';
