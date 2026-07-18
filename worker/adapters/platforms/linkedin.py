from __future__ import annotations

from adapters import linkedin as _fn
from adapters.platforms.base import PlatformAdapter, PlatformCapabilities
from adapters.platforms.registry import register

_CAPABILITIES = PlatformCapabilities(
    slug="linkedin",
    char_limit=3000,
    daily_limit=20,
    max_media=1,
    supported_media_mimes=("image/png", "image/jpeg", "image/gif"),
    uses_pkce=False,
    media_upload_style="register_upload",
    supports_idempotency_key=True,
    generation_hint=(
        "LinkedIn post (professional tone, 150–300 words, use line breaks for "
        "readability, may use 2–3 relevant emojis, end with a question or call-to-action)"
    ),
)


class LinkedInAdapter(PlatformAdapter):
    """Thin adapter delegating to the free functions in ``adapters/linkedin.py``.
    No HTTP logic lives here."""

    def capabilities(self) -> PlatformCapabilities:
        return _CAPABILITIES

    def build_authorization_url(
        self, state: str, code_challenge: str | None = None
    ) -> str:
        return _fn.build_authorization_url(state)

    async def exchange_code_for_tokens(
        self, code: str, code_verifier: str | None = None
    ) -> dict:
        return await _fn.exchange_code_for_tokens(code)

    async def refresh_token(self, refresh_token_value: str) -> dict:
        return await _fn.refresh_token(refresh_token_value)

    async def get_user_info(self, access_token: str) -> dict:
        info = await _fn.get_user_info(access_token)
        return {
            "platform_user_id": info.get("sub"),
            "platform_username": info.get("name") or info.get("email"),
        }

    async def upload_media(
        self,
        access_token: str,
        image_bytes: bytes,
        mime_type: str,
        author_urn: str | None = None,
    ) -> str:
        if not author_urn:
            raise ValueError("author_urn required for LinkedIn media upload")
        upload_url, asset_urn = await _fn.register_upload(
            access_token, author_urn, len(image_bytes)
        )
        await _fn.upload_bytes(upload_url, image_bytes)
        return asset_urn

    async def publish(
        self,
        *,
        access_token: str,
        body: str,
        media_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        author_urn: str | None = None,
    ) -> dict:
        if not author_urn:
            raise ValueError("author_urn required for LinkedIn publish")
        return await _fn.publish_post(
            access_token,
            author_urn,
            body,
            idempotency_key or "",
            media_ids,
        )

    async def get_post_metrics(
        self,
        access_token: str,
        platform_post_id: str,
        author_urn: str | None = None,
    ) -> dict:
        return await _fn.get_post_metrics(
            access_token, author_urn or "", platform_post_id
        )

    def classify_error(self, status: int) -> str:
        return _fn.classify_error(status)

    def build_author_urn(self, platform_user_id: str) -> str | None:
        return f"urn:li:person:{platform_user_id}"


register(LinkedInAdapter())
