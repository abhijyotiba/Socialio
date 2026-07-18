from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class PlatformCapabilities:
    """Static, per-platform facts the rest of the app dispatches on instead of
    branching on ``if platform == "linkedin"``. New platforms declare their own
    capabilities; callers stay platform-agnostic."""

    slug: str
    char_limit: int
    daily_limit: int
    max_media: int
    supported_media_mimes: tuple[str, ...]
    uses_pkce: bool
    media_upload_style: Literal["single_step", "register_upload"]
    supports_idempotency_key: bool
    generation_hint: str = ""


class PlatformAdapter(ABC):
    """Uniform interface over a social platform's OAuth, media, publish and
    metrics APIs. Concrete adapters delegate to the platform-specific free
    functions in ``adapters/{linkedin,x}.py`` — the ABC hides the divergences
    (PKCE vs. not, single-step vs. register-upload media, idempotency support)
    behind one signature so callers never special-case a platform."""

    @abstractmethod
    def capabilities(self) -> PlatformCapabilities:
        """Return this platform's static capabilities."""

    @abstractmethod
    def build_authorization_url(
        self, state: str, code_challenge: str | None = None
    ) -> str:
        """OAuth authorization URL. ``code_challenge`` is required only when the
        platform ``uses_pkce``."""

    @abstractmethod
    async def exchange_code_for_tokens(
        self, code: str, code_verifier: str | None = None
    ) -> dict:
        """Exchange an authorization code for tokens. ``code_verifier`` is
        required only when the platform ``uses_pkce``."""

    @abstractmethod
    async def refresh_token(self, refresh_token_value: str) -> dict:
        """Refresh an access token from a stored refresh token."""

    @abstractmethod
    async def get_user_info(self, access_token: str) -> dict:
        """Return ``{platform_user_id, platform_username}`` for the connection."""

    @abstractmethod
    async def upload_media(
        self,
        access_token: str,
        image_bytes: bytes,
        mime_type: str,
        author_urn: str | None = None,
    ) -> str:
        """Upload a single media asset, returning the platform media id/URN.
        LinkedIn runs register_upload + upload_bytes internally → asset URN;
        X uploads in a single step → media_id."""

    @abstractmethod
    async def publish(
        self,
        *,
        access_token: str,
        body: str,
        media_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        author_urn: str | None = None,
    ) -> dict:
        """Publish a post. Returns ``{platform_post_id, platform_post_url}``."""

    @abstractmethod
    async def get_post_metrics(
        self,
        access_token: str,
        platform_post_id: str,
        author_urn: str | None = None,
    ) -> dict:
        """Fetch engagement metrics for a published post."""

    @abstractmethod
    def classify_error(self, status: int) -> str:
        """Map an HTTP status to a stable error code (TOKEN_EXPIRED /
        RATE_LIMITED / CONTENT_POLICY / SERVER_ERROR / UNKNOWN)."""

    @abstractmethod
    def build_author_urn(self, platform_user_id: str) -> str | None:
        """Build the author identifier a publish call needs, or ``None`` when
        the platform has no such concept (X). LinkedIn → ``urn:li:person:{id}``."""
