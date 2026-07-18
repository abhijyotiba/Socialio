import pytest
from fastapi.testclient import TestClient

import main
import routes.posts as pr
from adapters.base import PublishError
from db import media_assets as db_media
from db import notifications as db_notifications
from db import persona_rate_limits as db_rate_limits
from db import posts as db_posts
from db import publish_attempts as db_attempts
from db import social_connections as db_connections
from publish import publisher
from security import vault


class _FakeAdapter:
    """Stand-in for a PlatformAdapter so the route/publisher tests never touch
    linkedin/x free functions directly. ``publish`` is overridable per-test."""

    def __init__(self):
        async def _default_publish(**_kwargs):
            return {
                "platform_post_id": "urn:li:share:1",
                "platform_post_url": "https://www.linkedin.com/feed/update/urn:li:share:1/",
            }

        self._publish = _default_publish

    def build_author_urn(self, platform_user_id):
        return f"urn:li:person:{platform_user_id}" if platform_user_id else None

    async def publish(self, **kwargs):
        return await self._publish(**kwargs)


@pytest.fixture
def client(monkeypatch):
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "tok"

    async def _rls(_token):
        return object()

    async def _svc():
        return object()

    async def _ws(_client, _uid):
        return "ws-1"

    monkeypatch.setattr(pr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(pr, "verify_user", _user)
    monkeypatch.setattr(pr, "rls_client", _rls)
    monkeypatch.setattr(pr, "service_client", _svc)
    monkeypatch.setattr(pr, "get_workspace_id_for_user", _ws)

    state = {"variant_status": None, "attempt_status": None}

    async def _variant(_client, vid):
        return {
            "id": vid,
            "workspace_id": "ws-1",
            "status": "draft",
            "persona_id": "p1",
            "platform": "linkedin",
            "body": "hello world",
            "platform_user_id": None,
        }

    async def _update_variant(_client, _vid, patch):
        if "status" in patch:
            state["variant_status"] = patch["status"]

    async def _has_success(_client, _key):
        return False

    async def _connection(_client, _pid, _platform):
        return {
            "platform_user_id": "li-123",
            "needs_reauth": False,
            "access_token_vault_id": "vault-1",
        }

    async def _latest(_client, _vid):
        return None

    async def _create_attempt(_client, _values):
        return {"id": "attempt-1"}

    async def _update_attempt(_client, _aid, patch):
        if "status" in patch:
            state["attempt_status"] = patch["status"]

    async def _read_secret(_svc, _vid):
        return "access-token"

    async def _media_urls(_client, _vid):
        return []

    async def _upload(_platform, _token, _urls, author_urn=None):
        return []

    async def _increment(_svc, _pid, _platform):
        return None

    async def _insert_notification(_client, _values):
        return None

    fake_adapter = _FakeAdapter()

    def _get_adapter(_slug):
        return fake_adapter

    monkeypatch.setattr(db_posts, "get_post_variant", _variant)
    monkeypatch.setattr(db_posts, "update_post_variant", _update_variant)
    monkeypatch.setattr(db_attempts, "has_successful_attempt", _has_success)
    monkeypatch.setattr(db_attempts, "get_latest_attempt", _latest)
    monkeypatch.setattr(db_attempts, "create_publish_attempt", _create_attempt)
    monkeypatch.setattr(db_attempts, "update_publish_attempt", _update_attempt)
    monkeypatch.setattr(db_connections, "get_social_connection_for_persona", _connection)
    monkeypatch.setattr(db_media, "get_variant_media_urls", _media_urls)
    monkeypatch.setattr(vault, "read_secret", _read_secret)
    monkeypatch.setattr(publisher, "upload_media_for_platform", _upload)
    monkeypatch.setattr(publisher, "get_adapter", _get_adapter)
    monkeypatch.setattr(db_rate_limits, "increment", _increment)
    monkeypatch.setattr(db_notifications, "insert_notification", _insert_notification)

    tc = TestClient(main.app)
    tc.state = state  # type: ignore[attr-defined]
    tc.fake_adapter = fake_adapter  # type: ignore[attr-defined]
    return tc


def test_publish_linkedin_success(client):
    res = client.post("/posts/v1/publish")
    assert res.status_code == 200
    assert res.json()["status"] == "published"
    assert client.state["variant_status"] == "published"
    assert client.state["attempt_status"] == "success"


def test_already_published(client, monkeypatch):
    async def _yes(_client, _key):
        return True

    monkeypatch.setattr(db_attempts, "has_successful_attempt", _yes)
    res = client.post("/posts/v1/publish")
    assert res.status_code == 409
    assert "already" in res.json()["error"]


def test_variant_not_found(client, monkeypatch):
    async def _none(_client, _vid):
        return None

    monkeypatch.setattr(db_posts, "get_post_variant", _none)
    res = client.post("/posts/v1/publish")
    assert res.status_code == 404


def test_non_publishable_status(client, monkeypatch):
    async def _published(_client, vid):
        return {"id": vid, "status": "published", "persona_id": "p1", "platform": "x", "body": "b"}

    monkeypatch.setattr(db_posts, "get_post_variant", _published)
    res = client.post("/posts/v1/publish")
    assert res.status_code == 409


def test_no_connection(client, monkeypatch):
    async def _none(_client, _pid, _platform):
        return None

    monkeypatch.setattr(db_connections, "get_social_connection_for_persona", _none)
    res = client.post("/posts/v1/publish")
    assert res.status_code == 409
    assert "connected" in res.json()["error"]


def test_needs_reauth(client, monkeypatch):
    async def _conn(_client, _pid, _platform):
        return {"needs_reauth": True, "access_token_vault_id": "v", "platform_user_id": "x"}

    monkeypatch.setattr(db_connections, "get_social_connection_for_persona", _conn)
    res = client.post("/posts/v1/publish")
    assert res.status_code == 409
    assert "re-authentication" in res.json()["error"]


def test_publish_token_expired_maps_to_401(client):
    async def _boom(**_kwargs):
        raise PublishError("LinkedIn publish failed: 401", "TOKEN_EXPIRED")

    client.fake_adapter._publish = _boom
    res = client.post("/posts/v1/publish")
    assert res.status_code == 401
    assert res.json()["error_code"] == "TOKEN_EXPIRED"
    # TOKEN_EXPIRED is terminal (refresh already failed by this point) → the
    # variant goes straight to failed_terminal, not the retry state.
    assert client.state["variant_status"] == "failed_terminal"
    assert client.state["attempt_status"] == "failed"


def test_publish_generic_failure_maps_to_502(client):
    async def _boom(**_kwargs):
        raise PublishError("LinkedIn publish failed: 500", "SERVER_ERROR")

    client.fake_adapter._publish = _boom
    res = client.post("/posts/v1/publish")
    assert res.status_code == 502
    assert res.json()["error_code"] == "SERVER_ERROR"
