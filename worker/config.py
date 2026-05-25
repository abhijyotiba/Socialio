from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    worker_shared_secret: str
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str
    playwright_timeout_ms: int = 20000

    # Supabase — used by the worker's RLS-scoped DB layer. The worker talks to
    # Postgres as the calling user (JWT forwarded from web), so the anon key is
    # correct here; RLS does the per-tenant enforcement. supabase_jwt_secret is
    # only needed for legacy HS256-signed projects (asymmetric projects use JWKS).
    supabase_url: str
    supabase_anon_key: str
    supabase_jwt_secret: str = ""
    # Service-role key — used ONLY for the Supabase Vault read on the publish
    # path (vault_read_secret is restricted to service_role). This is the same
    # documented exception the web app already makes; see docs/DECISIONS.md.
    supabase_service_role_key: str = ""

    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str
    gemini_model: str = "gemini-1.5-flash"

    firecrawl_api_key: str = ""
    firecrawl_timeout_s: int = 45


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
