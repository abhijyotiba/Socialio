from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # env_file: in local dev, uv run from the `worker/` dir so only `.env`
    # (inside worker/) is checked. The repo-root `../.env` is NOT loaded in
    # containers (Docker / Cloud Run / Render) because that path doesn't exist;
    # the platform injects env vars directly. extra="ignore" silences unknown keys.
    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    worker_shared_secret: str
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str

    # Supabase — used by the worker's RLS-scoped DB layer. The worker talks to
    # Postgres as the calling user (JWT forwarded from web), so the anon key is
    # correct here; RLS does the per-tenant enforcement. supabase_jwt_secret is
    # only needed for legacy HS256-signed projects (asymmetric projects use JWKS).
    supabase_url: str = Field(
        validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_anon_key: str = Field(
        validation_alias=AliasChoices(
            "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        )
    )
    supabase_jwt_secret: str = ""
    # Service-role key — used ONLY for the Supabase Vault read on the publish
    # path (vault_read_secret is restricted to service_role). This is the same
    # documented exception the web app already makes; see docs/DECISIONS.md.
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"
        ),
    )

    # Shared secret for the cron endpoints. Any external scheduler (Google Apps
    # Script, cron-job.org, GitHub Actions, etc.) calls /cron/* with
    # `Authorization: Bearer $CRON_SECRET`. Same value the web app uses.
    cron_secret: str = ""

    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str
    gemini_model: str = "gemini-1.5-flash"

    # Cap on concurrent in-flight LLM provider calls process-wide. Protects the
    # Groq/Gemini per-key rate limits when many cells render at once. Tune up as
    # provider quota allows; keep conservative by default.
    llm_max_concurrency: int = 5

    # Resend — transactional email for publish-failure / low-reservoir alerts.
    # When empty every email call is a silent no-op (safe for dev/staging).
    resend_api_key: str = ""
    resend_from_address: str = ""

    firecrawl_api_key: str = ""
    firecrawl_timeout_s: int = 45

    # OAuth — read directly via os.environ[...] in adapters/linkedin.py and
    # adapters/x.py. Declared here so they fail-fast at boot rather than at the
    # first OAuth callback hit in production.
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_redirect_uri: str = ""
    x_client_id: str = ""
    x_client_secret: str = ""
    x_redirect_uri: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
