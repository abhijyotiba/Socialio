-- Phase 1: Brand config, prompt versioning, LinkedIn/X connection metadata, and Vault helpers

CREATE TABLE public.prompt_versions (
	id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	version_number  INTEGER NOT NULL,
	system_prompt   TEXT NOT NULL,
	created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT prompt_versions_workspace_version_unique UNIQUE (workspace_id, version_number)
);

ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_versions_member_select" ON public.prompt_versions
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "prompt_versions_member_insert" ON public.prompt_versions
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE TABLE public.brand_configs (
	workspace_id               UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
	brand_name                 TEXT NOT NULL,
	industry                   TEXT,
	website_url                TEXT,
	tone_tags                  TEXT[] NOT NULL DEFAULT '{}',
	custom_system_prompt       TEXT,
	current_prompt_version_id  UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
	created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_configs_member_select" ON public.brand_configs
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "brand_configs_member_insert" ON public.brand_configs
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "brand_configs_member_update" ON public.brand_configs
	FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE TABLE public.social_connections (
	id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id           UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	platform               TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
	platform_user_id       TEXT,
	platform_username      TEXT,
	-- Supabase Vault secret reference IDs — never raw token values
	access_token_vault_id  UUID,
	refresh_token_vault_id UUID,
	token_expires_at       TIMESTAMPTZ,
	needs_reauth           BOOLEAN NOT NULL DEFAULT false,
	connected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT social_connections_workspace_platform_unique UNIQUE (workspace_id, platform)
);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_connections_member_select" ON public.social_connections
	FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "social_connections_member_insert" ON public.social_connections
	FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "social_connections_member_update" ON public.social_connections
	FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_prompt_versions_workspace ON public.prompt_versions(workspace_id);
CREATE INDEX idx_social_connections_workspace ON public.social_connections(workspace_id);
CREATE INDEX idx_social_connections_expires ON public.social_connections(token_expires_at);

-- updated_at trigger function (shared across tables)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_configs_updated_at ON public.brand_configs;
CREATE TRIGGER trg_brand_configs_updated_at
	BEFORE UPDATE ON public.brand_configs
	FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_social_connections_updated_at ON public.social_connections;
CREATE TRIGGER trg_social_connections_updated_at
	BEFORE UPDATE ON public.social_connections
	FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Vault wrapper functions — service_role only
-- Allows route handlers to store/retrieve token secrets via RPC without
-- exposing vault schema directly to the PostgREST layer.

CREATE OR REPLACE FUNCTION public.vault_create_secret(
	p_secret TEXT,
	p_name   TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
DECLARE
	v_id UUID;
BEGIN
	SELECT vault.create_secret(p_secret, p_name) INTO v_id;
	RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.vault_create_secret(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vault_create_secret(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.vault_read_secret(
	p_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
DECLARE
	v_secret TEXT;
BEGIN
	SELECT decrypted_secret INTO v_secret
	FROM vault.decrypted_secrets
	WHERE id = p_id;
	RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.vault_read_secret(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vault_read_secret(UUID) TO service_role;
