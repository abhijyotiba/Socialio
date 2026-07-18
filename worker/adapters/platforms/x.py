from __future__ import annotations

from adapters import x as _fn
from adapters.platforms.base import PlatformAdapter, PlatformCapabilities
from adapters.platforms.registry import register

_CAPABILITIES = PlatformCapabilities(
    slug="x",
    char_limit=280,
    daily_limit=50,
    max_media=4,
    supported_media_mimes=("image/png", "image/jpeg", "image/gif", "image/webp"),
    uses_pkce=True,
    media_upload_style="single_step",
    supports_idempotency_key=False,
    generation_hint=(
        "X/Twitter post (punchy, under 280 characters, conversational, "
        "no hashtag stuffing — at most 1–2 relevant hashtags)"
    ),
)


class XAdapter(PlatformAdapter):
    """Thin adapter delegating to the free functions in ``adapters/x.py``.
    No HTTP logic lives here."""

    def capabilities(self) -> PlatformCapabilities:
        return _CAPABILITIES

    def build_authorization_url(
        self, state: str, code_challenge: str | None = None
    ) -> str:
        if not code_challenge:
            raise ValueError("code_challenge required for X (PKCE)")
        return _fn.build_authorization_url(state, code_challenge)

    async def exchange_code_for_tokens(
        self, code: str, code_verifier: str | None = None
    ) -> dict:
        if not code_verifier:
            raise ValueError("code_verifier required for X (PKCE)")
        return await _fn.exchange_code_for_tokens(code, code_verifier)

    async def refresh_token(self, refresh_token_value: str) -> dict:
        return await _fn.refresh_token(refresh_token_value)

    async def get_user_info(self, access_token: str) -> dict:
        info = await _fn.get_user_info(access_token)
        data = info.get("data", {})
        return {
            "platform_user_id": data.get("id"),
            "platform_username": data.get("username"),
        }

    async def upload_media(
        self,
        access_token: str,
        image_bytes: bytes,
        mime_type: str,
        author_urn: str | None = None,
    ) -> str:
        return await _fn.upload_media(access_token, image_bytes, mime_type)

    async def publish(
        self,
        *,
        access_token: str,
        body: str,
        media_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        author_urn: str | None = None,
    ) -> dict:
        return await _fn.publish_tweet(access_token, body, media_ids)

    async def get_post_metrics(
        self,
        access_token: str,
        platform_post_id: str,
        author_urn: str | None = None,
    ) -> dict:
        return await _fn.get_post_metrics(access_token, platform_post_id)

    def classify_error(self, status: int) -> str:
        return _fn.classify_error(status)

    def build_author_urn(self, platform_user_id: str) -> str | None:
        return None


register(XAdapter())
