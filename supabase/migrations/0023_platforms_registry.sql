-- Task 2 — Platform registry table + CHECK→FK migration
--
-- Introduces `public.platforms` as the single source of truth for which social
-- platforms the product supports. Previously the supported set was duplicated as
-- an inline `CHECK (platform IN ('linkedin','x'))` constraint across five tables
-- plus TS constants and the platform adapter registry. Adding a platform meant
-- editing every one of those. After this migration, "add a platform" = one
-- `platforms` row (+ a new adapter module — Task 1), no schema edits.
--
-- This migration:
--   1. creates `platforms(slug PK, display_name, is_active, created_at)`, seeds
--      the current two platforms, and enables RLS with a read-all SELECT policy;
--   2. adds an FK from `platform_limits.platform → platforms(slug)`;
--   3. converts the five inline/unnamed platform CHECK constraints into FKs to
--      `platforms(slug)`. Because those CHECKs are inline (no explicit name), the
--      real system-assigned constraint name is looked up per table via
--      `pg_constraint` inside a DO block and dropped by that name before the FK
--      is added.
--
-- FALLBACK (documented per plan): if the FK conversion is rejected in review,
-- keep the inline CHECKs and drop steps (2)/(3) — then "add a platform" reverts
-- to one migration altering all five CHECK constraints. The `platforms` table
-- and adapter registry still stand on their own.

-- ── 1. platforms registry table ──────────────────────────────────────────────
CREATE TABLE public.platforms (
  slug         TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platforms (slug, display_name) VALUES
  ('linkedin', 'LinkedIn'),
  ('x',        'X');

-- Read-only from the public PostgREST surface. Writes go through migrations.
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY platforms_read_all ON public.platforms
  FOR SELECT USING (true);

-- ── 2. platform_limits.platform → platforms(slug) FK ─────────────────────────
-- platform_limits (migration 0016) has `platform TEXT PRIMARY KEY` with no
-- CHECK, so we only add the referential FK.
ALTER TABLE public.platform_limits
  ADD CONSTRAINT platform_limits_platform_fkey
  FOREIGN KEY (platform) REFERENCES public.platforms(slug);

-- ── 3. Convert the five inline platform CHECK constraints to FKs ─────────────
-- The CHECKs are inline/unnamed (e.g. `platform TEXT NOT NULL CHECK (platform IN
-- ('linkedin','x'))`), so Postgres assigns each an auto-generated name. We look
-- up the real name per (table, column) via pg_constraint by matching CHECK
-- constraints that reference the `platform` column, drop by that name, then add
-- the FK. The lookup targets CHECK constraints (contype='c') whose definition
-- mentions the platform column, avoiding NOT NULL / other constraints.
DO $$
DECLARE
  target       RECORD;
  con_name     TEXT;
  fk_name      TEXT;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('social_connections', 'platform'),
      ('post_variants',      'platform'),
      ('posting_schedules',  'platform'),
      ('content_cadences',   'platform'),
      ('content_items',      'platform')
    ) AS t(tbl, col)
  LOOP
    -- Find the CHECK constraint on this table that references the platform
    -- column (there is exactly one inline platform CHECK per table).
    SELECT c.conname
      INTO con_name
      FROM pg_constraint c
      JOIN pg_class      rel ON rel.oid = c.conrelid
      JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
      JOIN pg_attribute  att ON att.attrelid = c.conrelid
                            AND att.attnum = ANY (c.conkey)
     WHERE ns.nspname  = 'public'
       AND rel.relname = target.tbl
       AND c.contype   = 'c'
       AND att.attname = target.col
     LIMIT 1;

    IF con_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I',
        target.tbl, con_name
      );
    END IF;

    fk_name := target.tbl || '_' || target.col || '_platform_fkey';
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      || 'FOREIGN KEY (%I) REFERENCES public.platforms(slug)',
      target.tbl, fk_name, target.col
    );
  END LOOP;
END $$;

-- Tell PostgREST to reload its schema cache so the new table/FKs are exposed.
NOTIFY pgrst, 'reload schema';
