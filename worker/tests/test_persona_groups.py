"""Tests for account (persona) groups — Task 7: db helpers + routes."""

import pytest
from fastapi.testclient import TestClient

import main
import routes.persona_groups as pg
from db import persona_groups as db_groups


# ─── db.expand_group_ids_to_persona_ids ───────────────────────────────────────

class _Resp:
    def __init__(self, data):
        self.data = data


class _MembersClient:
    """Minimal fake for expand_group_ids_to_persona_ids (dedups across groups)."""

    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return self

    def select(self, _cols):
        return self

    def in_(self, _field, values):
        self._filter = set(values)
        return self

    async def execute(self):
        return _Resp(
            [r for r in self._rows if r["group_id"] in self._filter]
        )


@pytest.mark.asyncio
async def test_expand_group_ids_dedups_across_overlaps():
    rows = [
        {"group_id": "g1", "persona_id": "p1"},
        {"group_id": "g1", "persona_id": "p2"},
        {"group_id": "g2", "persona_id": "p2"},  # overlap
        {"group_id": "g2", "persona_id": "p3"},
    ]
    client = _MembersClient(rows)
    result = await db_groups.expand_group_ids_to_persona_ids(client, ["g1", "g2"])
    assert sorted(result) == ["p1", "p2", "p3"]
    assert len(result) == 3  # p2 not duplicated


@pytest.mark.asyncio
async def test_expand_group_ids_empty_returns_empty():
    client = _MembersClient([])
    assert await db_groups.expand_group_ids_to_persona_ids(client, []) == []


# ─── routes ───────────────────────────────────────────────────────────────────

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

    monkeypatch.setattr(pg, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(pg, "verify_user", _user)
    monkeypatch.setattr(pg, "rls_client", _rls)
    monkeypatch.setattr(pg, "get_workspace_id_for_user", _ws)

    state = {"created": [], "members": [], "renamed": [], "deleted": []}

    async def _create_group(_client, ws, name):
        state["created"].append((ws, name))
        return {"id": "g-1", "workspace_id": ws, "name": name}

    async def _add_members(_client, gid, pids):
        state["members"].append((gid, list(pids)))

    async def _set_members(_client, gid, pids):
        state["members"].append((gid, list(pids)))

    async def _rename(_client, gid, name):
        state["renamed"].append((gid, name))
        return {"id": gid, "name": name}

    async def _delete(_client, gid):
        state["deleted"].append(gid)

    monkeypatch.setattr(db_groups, "create_group", _create_group)
    monkeypatch.setattr(db_groups, "add_members", _add_members)
    monkeypatch.setattr(db_groups, "set_members", _set_members)
    monkeypatch.setattr(db_groups, "rename_group", _rename)
    monkeypatch.setattr(db_groups, "delete_group", _delete)

    tc = TestClient(main.app)
    tc.state = state  # type: ignore[attr-defined]
    return tc


def test_create_group_with_members(client):
    res = client.post(
        "/account-groups", json={"name": "Founders", "persona_ids": ["p1", "p2"]}
    )
    assert res.status_code == 201
    body = res.json()
    assert body["group"]["name"] == "Founders"
    assert body["group"]["persona_ids"] == ["p1", "p2"]
    assert client.state["created"] == [("ws-1", "Founders")]
    assert client.state["members"] == [("g-1", ["p1", "p2"])]


def test_create_group_rejects_empty_name(client):
    res = client.post("/account-groups", json={"name": ""})
    assert res.status_code in (400, 422)


def test_rename_group(client):
    res = client.patch("/account-groups/g-1", json={"name": "New Name"})
    assert res.status_code == 200
    assert client.state["renamed"] == [("g-1", "New Name")]


def test_rename_missing_group_404(client, monkeypatch):
    async def _rename_none(_client, _gid, _name):
        return None

    monkeypatch.setattr(db_groups, "rename_group", _rename_none)
    res = client.patch("/account-groups/gone", json={"name": "X"})
    assert res.status_code == 404


def test_delete_group(client):
    res = client.request("DELETE", "/account-groups/g-1")
    assert res.status_code == 200
    assert client.state["deleted"] == ["g-1"]


def test_set_members_replaces(client):
    res = client.put(
        "/account-groups/g-1/members", json={"persona_ids": ["p3", "p4", "p3"]}
    )
    assert res.status_code == 200
    # dedup preserved in response
    assert res.json()["persona_ids"] == ["p3", "p4"]
