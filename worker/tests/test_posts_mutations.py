import pytest
from fastapi.testclient import TestClient

import main
import routes.posts as pr
from db import posts as db_posts
from db import post_variant_revisions as db_revisions
from db import media_assets as db_media


@pytest.fixture
def client(monkeypatch):
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "tok"

    async def _rls(_token):
        return object()

    async def _ws(_client, _uid):
        return "ws-1"

    monkeypatch.setattr(pr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(pr, "verify_user", _user)
    monkeypatch.setattr(pr, "rls_client", _rls)
    monkeypatch.setattr(pr, "get_workspace_id_for_user", _ws)

    # DB mocks
    async def _get(_client, pid):
        if pid == "nonexistent":
            return None
        return {
            "id": pid,
            "workspace_id": "ws-1",
            "platform": "linkedin",
            "body": "original content",
            "status": "draft",
        }

    async def _update(_client, _pid, _patch):
        return None

    monkeypatch.setattr(db_posts, "get_post_variant", _get)
    monkeypatch.setattr(db_posts, "update_post_variant", _update)

    return TestClient(main.app)


def test_schedule_post_happy_path(client):
    # Scheduled for 1 hour in the future
    from datetime import datetime, timedelta, timezone
    future_time = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    res = client.post("/posts/var-1/schedule", json={"scheduled_at": future_time})
    assert res.status_code == 200
    assert res.json()["status"] == "scheduled"


def test_schedule_post_past_time(client):
    # Scheduled in the past
    res = client.post("/posts/var-1/schedule", json={"scheduled_at": "2020-01-01T00:00:00Z"})
    assert res.status_code == 400
    assert "future" in res.json()["error"]


def test_schedule_post_invalid_date(client):
    res = client.post("/posts/var-1/schedule", json={"scheduled_at": "invalid-date"})
    assert res.status_code == 400


def test_cancel_post_happy_path(client, monkeypatch):
    async def _get_scheduled(_client, pid):
        return {
            "id": pid,
            "workspace_id": "ws-1",
            "platform": "linkedin",
            "body": "original content",
            "status": "scheduled",
        }

    monkeypatch.setattr(db_posts, "get_post_variant", _get_scheduled)
    res = client.post("/posts/var-1/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


def test_cancel_post_not_scheduled(client):
    res = client.post("/posts/var-1/cancel")  # status is draft in mock
    assert res.status_code == 409


def test_review_approve_moves_pending_to_draft(client, monkeypatch):
    captured = {}

    async def _get_pending(_client, pid):
        return {
            "id": pid, "workspace_id": "ws-1", "platform": "linkedin",
            "body": "x", "status": "pending_approval",
        }

    async def _update(_client, _pid, patch):
        captured.update(patch)

    monkeypatch.setattr(db_posts, "get_post_variant", _get_pending)
    monkeypatch.setattr(db_posts, "update_post_variant", _update)
    res = client.post("/posts/var-1/review", json={"action": "approve"})
    assert res.status_code == 200
    assert res.json()["status"] == "draft"
    assert captured["status"] == "draft"


def test_review_reject_moves_pending_to_cancelled(client, monkeypatch):
    captured = {}

    async def _get_pending(_client, pid):
        return {
            "id": pid, "workspace_id": "ws-1", "platform": "linkedin",
            "body": "x", "status": "pending_approval",
        }

    async def _update(_client, _pid, patch):
        captured.update(patch)

    monkeypatch.setattr(db_posts, "get_post_variant", _get_pending)
    monkeypatch.setattr(db_posts, "update_post_variant", _update)
    res = client.post("/posts/var-1/review", json={"action": "reject"})
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    assert captured["status"] == "cancelled"


def test_review_rejects_non_pending_variant(client):
    # default mock status is "draft" — not reviewable
    res = client.post("/posts/var-1/review", json={"action": "approve"})
    assert res.status_code == 409


def test_review_rejects_bad_action(client, monkeypatch):
    async def _get_pending(_client, pid):
        return {
            "id": pid, "workspace_id": "ws-1", "platform": "linkedin",
            "body": "x", "status": "pending_approval",
        }

    monkeypatch.setattr(db_posts, "get_post_variant", _get_pending)
    res = client.post("/posts/var-1/review", json={"action": "maybe"})
    assert res.status_code == 400


def test_patch_post_happy_path(client):
    res = client.patch("/posts/var-1", json={"body": "updated content"})
    assert res.status_code == 200
    assert res.json() == {"saved": True}


def test_patch_post_exceeds_limit(client):
    # LinkedIn limit is 3000, X is 280.
    # In general mock setup, platform is linkedin. Let's send 3001 characters.
    res = client.patch("/posts/var-1", json={"body": "A" * 3001})
    assert res.status_code == 400


def test_update_media_happy_path(client, monkeypatch):
    async def _set_media(_client, _pid, _ids):
        return None

    monkeypatch.setattr(db_media, "set_variant_media", _set_media)
    res = client.put("/posts/var-1/media", json={"media_asset_ids": ["uuid-1", "uuid-2"]})
    assert res.status_code == 200
    assert res.json() == {"saved": True}


def test_update_media_too_many(client):
    res = client.put("/posts/var-1/media", json={"media_asset_ids": ["a", "b", "c", "d", "e"]})
    assert res.status_code == 400


def test_revert_post_happy_path(client, monkeypatch):
    async def _list_revisions(_client, _pid):
        return [
            {"revision_number": 1, "body": "old body revision 1"},
            {"revision_number": 2, "body": "original content"},
        ]

    async def _snapshot(_client, **kwargs):
        return {"revision_number": 3}

    monkeypatch.setattr(db_revisions, "list_variant_revisions", _list_revisions)
    monkeypatch.setattr(db_revisions, "snapshot_variant_body", _snapshot)

    res = client.post("/posts/var-1/revert", json={"revision_number": 1})
    assert res.status_code == 200
    assert res.json()["body"] == "old body revision 1"
    assert res.json()["revision_number"] == 3
