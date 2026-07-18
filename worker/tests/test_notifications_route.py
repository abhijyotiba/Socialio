"""Worker mark-read notification routes (Task 4).

Thin RLS-scoped mutations: POST /notifications/{id}/read and
/notifications/read-all. HMAC/JWT/workspace resolution are stubbed (covered by
auth tests elsewhere); these assert the route wiring + db-helper delegation.
"""

import pytest
from fastapi.testclient import TestClient

import main
import routes.notifications as nr
from db import notifications as db_notifications


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

    monkeypatch.setattr(nr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(nr, "verify_user", _user)
    monkeypatch.setattr(nr, "rls_client", _rls)
    monkeypatch.setattr(nr, "get_workspace_id_for_user", _ws)
    return TestClient(main.app)


def test_mark_read_happy_path(client, monkeypatch):
    async def _mark_read(_client, _nid):
        return True

    monkeypatch.setattr(db_notifications, "mark_read", _mark_read)
    res = client.post("/notifications/n1/read")
    assert res.status_code == 200
    assert res.json() == {"status": "read"}


def test_mark_read_not_found(client, monkeypatch):
    async def _mark_read(_client, _nid):
        return False

    monkeypatch.setattr(db_notifications, "mark_read", _mark_read)
    res = client.post("/notifications/missing/read")
    assert res.status_code == 404


def test_mark_all_read(client, monkeypatch):
    async def _mark_all(_client, _ws):
        return 3

    monkeypatch.setattr(db_notifications, "mark_all_read", _mark_all)
    res = client.post("/notifications/read-all")
    assert res.status_code == 200
    assert res.json() == {"status": "read", "count": 3}
