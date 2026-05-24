-- Phase V2.2 follow-up — capture the user's "angle" on a campaign
--
-- Today the campaign route generates from extracted source text plus the
-- persona's brand voice. There's no place to attach the user's intent —
-- "make it skeptical," "focus on pricing," or in the prompt-only flow the
-- whole topic itself. This column stores that user-supplied instruction
-- so it's visible on the campaign detail page and re-applicable on
-- regenerate.
--
-- Nullable because pre-existing campaigns have no angle, and the
-- "URL only, no instruction" case is still valid.

ALTER TABLE public.campaigns
  ADD COLUMN user_angle TEXT;
