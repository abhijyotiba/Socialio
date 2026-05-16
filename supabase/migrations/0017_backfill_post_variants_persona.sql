-- Phase V2.2 hardening — backfill pre-persona post_variants
--
-- Migration 0014 made post_variants.persona_id nullable, did a best-effort
-- backfill via content_items → workspace → default persona, and left the
-- column nullable because the FK is ON DELETE SET NULL (so a future persona
-- deletion can re-introduce NULLs).
--
-- This migration handles the last category of rows the original backfill
-- missed: post_variants whose content_item references a workspace whose
-- default persona has since been changed, or rows inserted between the
-- original backfill and the route migration. It also asserts that any
-- remaining NULL persona_id rows after this migration are explainable
-- (have no content_item or no default persona for that workspace).
--
-- The `_legacy/` fallback in the cron, publish, and regenerate routes is
-- NOT removed by this migration. It still has a legitimate reason to
-- exist: deleting a persona sets persona_id to NULL on its variants, and
-- those NULL rows continue to need a publish path. That fallback should
-- only be removed once we either (a) prevent persona deletion while
-- variants exist, or (b) change the FK to ON DELETE CASCADE.

UPDATE public.post_variants pv
SET persona_id = p.id
FROM public.content_items ci
JOIN public.personas p
  ON p.workspace_id = ci.workspace_id AND p.is_default = true
WHERE pv.content_item_id = ci.id
  AND pv.persona_id IS NULL;

-- Reporting only — never raise; this is observational.
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.post_variants
  WHERE persona_id IS NULL;
  RAISE NOTICE 'post_variants rows with NULL persona_id after backfill: %', null_count;
END $$;
