"""Retry/backoff behaviour of the shared publish path (Task 4).

Covers the three status transitions the reliability design hinges on:
  * a retryable error under the retry limit → status stays 'failed', retry_count
    is bumped, and next_retry_at is set to the backoff bucket;
  * the retry limit being reached → status 'failed_terminal' + a publish_failed
    notification;
  * a non-retryable (terminal) error code → 'failed_terminal' immediately.
No live Supabase — every DB/vault/media dependency is a stub.
"""

import pytest

from adapters.base import PublishError
from db import media_assets as db_media
from db import notifications as db_notifications
from db import persona_rate_limits as db_rate_limits
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


CONNECTION = {
    "platform_user_id": "li-123",
    "needs_reauth": False,
    "access_token_vault_id": "vault-1",
}


@pytest.fixture
def mocks(monkeypatch):
    """Capture variant status writes + inserted notifications so each test can
    assert on the retry/terminal transition it exercises."""
    state = {"variant": [], "notifications": []}

    async def _update_variant(_client, _vid, patch):
        state["variant"].append(patch)

    async def _insert_notification(_client, values):
        state["notifications"].append(values)

    monkeypatch.setattr(db_attempts, "has_successful_attempt", _aret(False))
    monkeypatch.setattr(db_attempts, "get_latest_attempt", _aret(None))
    monkeypatch.setattr(db_attempts, "create_publish_attempt", _aret({"id": "a1"}))
    monkeypatch.setattr(db_attempts, "update_publish_attempt", _aret(None))
    monkeypatch.setattr(db_posts, "update_post_variant", _update_variant)
    monkeypatch.setattr(db_media, "get_variant_media_urls", _aret([]))
    monkeypatch.setattr(vault, "read_secret", _aret("access-token"))
    monkeypatch.setattr(publisher, "upload_media_for_platform", _aret([]))
    monkeypatch.setattr(db_rate_limits, "increment", _aret(None))
    monkeypatch.setattr(db_notifications, "insert_notification", _insert_notification)

    fake = _FakeAdapter()
    monkeypatch.setattr(publisher, "get_adapter", lambda _slug: fake)
    return state, fake


def _variant(retry_count):
    return {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "linkedin",
        "body": "hello",
        "retry_count": retry_count,
    }


@pytest.mark.asyncio
async def test_retryable_under_limit_sets_next_retry_and_bumps_count(mocks):
    state, fake = mocks

    async def _boom(**_k):
        raise PublishError("LinkedIn publish failed: 500", "SERVER_ERROR")

    fake._publish = _boom

    result = await publisher.publish_variant(
        object(), object(), _variant(0), CONNECTION, idempotency_key="v1"
    )

    assert result.ok is False
    assert result.error_code == "SERVER_ERROR"
    patch = state["variant"][-1]
    assert patch["status"] == "failed"
    assert patch["retry_count"] == 1
    assert patch["next_retry_at"] is not None
    # First retry uses the 5-minute bucket; no terminal notification yet.
    assert state["notifications"] == []


@pytest.mark.asyncio
async def test_third_failure_goes_terminal_and_notifies(mocks):
    state, fake = mocks

    async def _boom(**_k):
        raise PublishError("Rate limited", "RATE_LIMITED")

    fake._publish = _boom

    # retry_count already at the max (3) → retries exhausted.
    result = await publisher.publish_variant(
        object(), object(), _variant(3), CONNECTION, idempotency_key="v1"
    )

    assert result.ok is False
    patch = state["variant"][-1]
    assert patch["status"] == "failed_terminal"
    assert patch["next_retry_at"] is None
    assert len(state["notifications"]) == 1
    note = state["notifications"][0]
    assert note["kind"] == "publish_failed"
    assert note["entity_type"] == "post_variant"
    assert note["entity_id"] == "v1"
    assert note["workspace_id"] == "ws1"
    assert note["persona_id"] == "pp1"


@pytest.mark.asyncio
async def test_terminal_code_goes_terminal_immediately(mocks):
    state, fake = mocks

    async def _boom(**_k):
        raise PublishError("Rejected by policy", "CONTENT_POLICY")

    fake._publish = _boom

    # retry_count 0 but CONTENT_POLICY is non-retryable → terminal on first try.
    result = await publisher.publish_variant(
        object(), object(), _variant(0), CONNECTION, idempotency_key="v1"
    )

    assert result.ok is False
    assert result.error_code == "CONTENT_POLICY"
    patch = state["variant"][-1]
    assert patch["status"] == "failed_terminal"
    assert "retry_count" not in patch
    assert len(state["notifications"]) == 1


@pytest.mark.asyncio
async def test_retryable_honors_retry_after_header(mocks):
    state, fake = mocks

    async def _boom(**_k):
        err = PublishError("Rate limited", "RATE_LIMITED")
        err.retry_after = 120  # seconds, from a Retry-After header
        raise err

    fake._publish = _boom

    before = publisher.datetime.now(publisher.timezone.utc)
    await publisher.publish_variant(
        object(), object(), _variant(0), CONNECTION, idempotency_key="v1"
    )
    patch = state["variant"][-1]
    assert patch["status"] == "failed"
    # next_retry_at should be ~120s out (retry-after), well under the 5-min bucket.
    next_at = publisher.datetime.fromisoformat(patch["next_retry_at"])
    delta = (next_at - before).total_seconds()
    assert 100 <= delta <= 180
