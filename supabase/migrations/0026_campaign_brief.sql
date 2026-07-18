-- Task 6 — structured campaign brief + scheduling window
--
-- Today a campaign carries only a free-text `user_angle`. The network-operator
-- pivot needs a richer, structured brief so one campaign can drive 50 personas
-- with a consistent goal / message / tone / CTA and explicit do/don't guidance,
-- plus an optional publishing window that Task 7's scheduler spreads variants
-- across.
--
-- Additive + nullable (0019/0021 pattern): pre-existing campaigns have no brief
-- and keep working off `user_angle`, which is retained for back-compat. `brief`
-- is preferred over `user_angle` by the generation pipeline when present.
--
--   brief JSONB shape:
--     {
--       "goal":            text | null,
--       "core_message":    text | null,
--       "tone":            text | null,
--       "cta":             text | null,
--       "do":              text[] (default []),
--       "dont":            text[] (default []),
--       "media_asset_ids": uuid[] (default [], bounded to 4 by the worker)
--     }

ALTER TABLE public.campaigns
  ADD COLUMN brief        JSONB,
  ADD COLUMN window_start TIMESTAMPTZ,
  ADD COLUMN window_end   TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
