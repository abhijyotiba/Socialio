from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    worker_shared_secret: str
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str
    playwright_timeout_ms: int = 20000

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
