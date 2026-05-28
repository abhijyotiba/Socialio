import pytest
from fastapi.testclient import TestClient

import main
import routes.schedule_slots as sr
from db import posting_schedules as db_schedules


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

    monkeypatch.setattr(sr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(sr, "verify_user", _user)
    monkeypatch.setattr(sr, "rls_client", _rls)
    monkeypatch.setattr(sr, "get_workspace_id_for_user", _ws)

    # DB mocks
    async def _create(_client, values):
        return {"id": "slot-1", **values}

    async def _delete(_client, _slot_id, _ws_id):
        return None

    monkeypatch.setattr(db_schedules, "create_schedule_slot", _create)
    monkeypatch.setattr(db_schedules, "delete_schedule_slot", _delete)

    return TestClient(main.app)


def test_create_schedule_slot_happy_path(client):
    res = client.post(
        "/schedule-slots",
        json={
            "platform": "linkedin",
            "hour": 10,
            "minute": 30,
            "days_of_week": [1, 2, 3],
            "timezone": "America/New_York",
            "persona_id": "p-1",
        },
    )
    assert res.status_code == 200
    assert res.json()["id"] == "slot-1"
    assert res.json()["platform"] == "linkedin"
    assert res.json()["hour"] == 10
    assert res.json()["minute"] == 30


def test_create_schedule_slot_invalid_platform(client):
    res = client.post(
        "/schedule-slots",
        json={
            "platform": "instagram",
            "hour": 10,
            "minute": 30,
            "days_of_week": [1],
            "timezone": "UTC",
        },
    )
    assert res.status_code == 400


def test_create_schedule_slot_invalid_minute(client):
    res = client.post(
        "/schedule-slots",
        json={
            "platform": "x",
            "hour": 10,
            "minute": 15,
            "days_of_week": [1],
            "timezone": "UTC",
        },
    )
    assert res.status_code == 400


def test_create_schedule_slot_invalid_day(client):
    res = client.post(
        "/schedule-slots",
        json={
            "platform": "x",
            "hour": 10,
            "minute": 30,
            "days_of_week": [7],  # must be 0-6
            "timezone": "UTC",
        },
    )
    assert res.status_code == 400


def test_delete_schedule_slot_happy_path(client):
    res = client.request("DELETE", "/schedule-slots/slot-1")
    assert res.status_code == 200
    assert res.json() == {"deleted": True}
