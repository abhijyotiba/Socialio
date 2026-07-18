"""Unit tests for the shared publish path in ``publish.publisher``.

Exercises the three behaviours the two callers (manual-publish route and
publish-due cron) rely on: the success path writes a success attempt + a
published variant, a retryable platform error returns ``ok=False`` with the
error code (recorded as a failed attempt), and a variant that already has a
successful attempt short-circuits without touching the platform.
"""

import pytest

from adapters.base import PublishError
from db import media_assets as db_media
from db import posts as db_posts
from db import publish_attempts as db_attempts
from publish import publisher
from security import vault


def _aret(value):
    async def _f(*_a, **_k):
        return value

    return _f


class _FakeAdapter:
    def __init__(self, *, publish=None):
        self._publish = publish or _aret(
            {"platform_post_id": "p1", "platform_post_url": "u1"}
        )

    def build_author_urn(self, platform_user_id):
        return f"urn:li:person:{platform_user_id}" if platform_user_id else None

    async def publish(self, **kwargs):
        return await self._publish(**kwargs)


VARIANT = {
    "id": "v1",
    "workspace_id": "ws1",
    "platform": "linkedin",
    "body": "hello world",
}
CONNECTION = {
    "platform_user_id": "li-123",
    "needs_reauth": False,
    "access_token_vault_id": "vault-1",
}


@pytest.fixture
def base_mocks(monkeypatch):
    """Wire every DB/vault/media dependency to harmless stubs and capture the
    attempt + variant status writes so tests can assert on them."""
    state = {"variant": [], "attempt": []}

    async def _update_variant(_client, _vid, patch):
        state["variant"].append(patch)

    async def _update_attempt(_client, _aid, patch):
        state["attempt"].append(patch)

    monkeypatch.setattr(db_attempts, "has_successful_attempt", _aret(False))
    monkeypatch.setattr(db_attempts, "get_latest_attempt", _aret(None))
    monkeypatch.setattr(db_attempts, "create_publish_attempt", _aret({"id": "a1"}))
    monkeypatch.setattr(db_attempts, "update_publish_attempt", _update_attempt)
    monkeypatch.setattr(db_posts, "update_post_variant", _update_variant)
    monkeypatch.setattr(db_media, "get_variant_media_urls", _aret([]))
    monkeypatch.setattr(vault, "read_secret", _aret("access-token"))
    monkeypatch.setattr(publisher, "upload_media_for_platform", _aret([]))

    fake = _FakeAdapter()
    monkeypatch.setattr(publisher, "get_adapter", lambda _slug: fake)
    return state, fake


@pytest.mark.asyncio
async def test_success_writes_success_attempt_and_published_status(base_mocks):
    state, _fake = base_mocks
    result = await publisher.publish_variant(
        object(), object(), VARIANT, CONNECTION, idempotency_key="v1"
    )

    assert result.ok is True
    assert result.platform_post_id == "p1"
    assert result.platform_post_url == "u1"
    assert state["attempt"][-1]["status"] == "success"
    published = [p for p in state["variant"] if p.get("status") == "published"]
    assert published and published[-1]["platform_post_id"] == "p1"


@pytest.mark.asyncio
async def test_retryable_error_returns_ok_false_with_error_code(base_mocks):
    state, fake = base_mocks

    async def _boom(**_kwargs):
        raise PublishError("LinkedIn publish failed: 500", "SERVER_ERROR")

    fake._publish = _boom

    result = await publisher.publish_variant(
        object(), object(), VARIANT, CONNECTION, idempotency_key="v1"
    )

    assert result.ok is False
    assert result.error_code == "SERVER_ERROR"
    assert result.error_detail == "LinkedIn publish failed: 500"
    assert state["attempt"][-1]["status"] == "failed"
    assert state["variant"][-1]["status"] == "failed"


@pytest.mark.asyncio
async def test_idempotent_shortcut_when_already_published(monkeypatch, base_mocks):
    state, fake = base_mocks
    monkeypatch.setattr(db_attempts, "has_successful_attempt", _aret(True))

    async def _must_not_publish(**_kwargs):
        raise AssertionError("adapter.publish must not be called on short-circuit")

    fake._publish = _must_not_publish

    async def _must_not_create(*_a, **_k):
        raise AssertionError("no attempt row should be created on short-circuit")

    monkeypatch.setattr(db_attempts, "create_publish_attempt", _must_not_create)

    result = await publisher.publish_variant(
        object(), object(), VARIANT, CONNECTION, idempotency_key="v1"
    )

    assert result.ok is True
    assert state["attempt"] == []
    assert state["variant"][-1]["status"] == "published"
