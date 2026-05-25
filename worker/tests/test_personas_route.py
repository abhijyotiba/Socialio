import pytest
from fastapi.testclient import TestClient

import main
import routes.personas as pr
from db import personas as db_personas


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

    async def _count(_client, _ws):
        return 0

    async def _create(_client, _ws, name, color):
        return {"id": "p-1", "name": name, "avatar_color": color or "#6366f1"}

    async def _get(_client, pid):
        return {"id": pid, "name": "X"}

    async def _update(_client, _pid, _patch):
        return None

    async def _delete(_client, _pid):
        return None

    monkeypatch.setattr(db_personas, "count_personas", _count)
    monkeypatch.setattr(db_personas, "create_persona", _create)
    monkeypatch.setattr(db_personas, "get_persona", _get)
    monkeypatch.setattr(db_personas, "update_persona", _update)
    monkeypatch.setattr(db_personas, "delete_persona", _delete)

    return TestClient(main.app)


def test_create_persona(client):
    res = client.post("/personas", json={"name": "Marketing"})
    assert res.status_code == 201
    assert res.json()["persona"]["name"] == "Marketing"


def test_create_invalid_color(client):
    res = client.post("/personas", json={"name": "X", "avatar_color": "red"})
    assert res.status_code == 400


def test_create_blocked_by_soft_cap(client, monkeypatch):
    async def _count(_client, _ws):
        return 10

    monkeypatch.setattr(db_personas, "count_personas", _count)
    res = client.post("/personas", json={"name": "X"})
    assert res.status_code == 400
    assert "limit" in res.json()["error"]


def test_create_hard_cap_value_error(client, monkeypatch):
    async def _create(_client, _ws, _name, _color):
        raise ValueError("Workspace has reached the maximum of 50 personas")

    monkeypatch.setattr(db_personas, "create_persona", _create)
    res = client.post("/personas", json={"name": "X"})
    assert res.status_code == 400
    assert "maximum" in res.json()["error"]


def test_patch_persona(client):
    res = client.patch("/personas/p-1", json={"name": "Renamed"})
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_patch_not_found(client, monkeypatch):
    async def _none(_client, _pid):
        return None

    monkeypatch.setattr(db_personas, "get_persona", _none)
    res = client.patch("/personas/p-1", json={"name": "x"})
    assert res.status_code == 404


def test_delete_persona(client):
    res = client.request("DELETE", "/personas/p-1")
    assert res.status_code == 200


def test_delete_guard_returns_409(client, monkeypatch):
    async def _delete(_client, _pid):
        raise ValueError("Cannot delete the default persona")

    monkeypatch.setattr(db_personas, "delete_persona", _delete)
    res = client.request("DELETE", "/personas/p-1")
    assert res.status_code == 409
    assert "default persona" in res.json()["error"]
