-- Phase 0: Foundation
-- Creates profiles, workspaces, workspace_members tables with RLS,
-- the user_workspace_ids() helper, and the handle_new_user() signup trigger.

-- ─────────────────────────────────────────────────────────────────
-- Profiles: one per user, extends auth.users with display fields
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_select" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- Workspaces: top-level tenant boundary
-- One workspace per user in V1; model supports many in V2.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE public.workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────
-- Workspace members: join table between users and workspaces.
-- Exists from Phase 0 so all downstream tables can FK to workspace_id
-- instead of user_id — no migration needed when team support ships.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_self_select" ON public.workspace_members
  FOR SELECT USING (user_id = auth.uid());

-- Workspaces are readable by their members
CREATE POLICY "workspaces_member_select" ON public.workspaces
  FOR SELECT USING (
    id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- Helper: returns workspace IDs the current user belongs to.
-- Used in RLS policies on every downstream table.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────
-- Signup trigger: on new auth.users row, create profile + workspace + membership.
-- SECURITY DEFINER so it can insert into tables the user role cannot write to.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  INSERT INTO public.workspaces (name)
  VALUES (
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ) || '''s workspace'
  )
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
