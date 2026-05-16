-- Phase V2.2 Step D — campaign failure metadata + per-variant prompt snapshot
--
-- Two small additions, both nullable, no destructive changes.
--
-- 1. campaigns gains failure_reason / failure_code so the cron zombie
--    sweeper and the campaign route can record why a campaign died.
--    Previously the only signal was the audit_events row; the UI now reads
--    these columns directly on the campaign row for inbox display.
--
-- 2. campaign_persona_variants gets a prompt_version_id snapshot. The
--    campaigns route writes this at generation time so a later voice-profile
--    refresh does not silently desync the variant's "voice of origin".

ALTER TABLE public.campaigns
  ADD COLUMN failure_reason TEXT,
  ADD COLUMN failure_code   TEXT;

ALTER TABLE public.campaign_persona_variants
  ADD COLUMN prompt_version_id UUID REFERENCES public.prompt_versions(id);

CREATE INDEX campaign_persona_variants_prompt_version_id_idx
  ON public.campaign_persona_variants(prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;
