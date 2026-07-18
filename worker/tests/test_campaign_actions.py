import pytest
from fastapi.testclient import TestClient

import main
import routes.campaigns as cr
from db import audit_events as db_audit
from db import campaigns as db_campaigns


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

    monkeypatch.setattr(cr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(cr, "verify_user", _user)
    monkeypatch.setattr(cr, "rls_client", _rls)
    monkeypatch.setattr(cr, "get_workspace_id_for_user", _ws)

    state = {
        "campaign": {"id": "camp-1", "workspace_id": "ws-1"},
        "personas": [
            {"id": "cp-1", "persona_id": "p1", "approval_status": "pending"},
            {"id": "cp-2", "persona_id": "p2", "approval_status": "pending"},
        ],
        "approvals": [],
        "variants_scheduled": [],
        "scheduled_at": {},
        "assign_windows": [],
        "campaign_status": None,
        "deleted": False,
        "cancelled": 0,
        "live": False,
    }

    async def _get_campaign(_client, _cid):
        return state["campaign"]

    async def _get_personas(_client, _cid):
        return state["personas"]

    async def _update_approval(_client, cp_id, status):
        state["approvals"].append((cp_id, status))
        for cp in state["personas"]:
            if cp["id"] == cp_id:
                cp["approval_status"] = status

    async def _get_variants(_client, cp_id):
        return [f"v-{cp_id}"]

    async def _set_status(_client, vids, status):
        state["variants_scheduled"].extend((v, status) for v in vids)

    async def _assign_scheduled_times(_client, vids, **kwargs):
        # Mirror the real contract: a distinct non-null iso timestamp per variant.
        assigned = {v: f"2026-08-0{i + 1}T00:00:00+00:00" for i, v in enumerate(vids)}
        state["scheduled_at"].update(assigned)
        state["assign_windows"].append(
            (kwargs.get("window_start"), kwargs.get("window_end"))
        )
        return assigned

    async def _update_campaign(_client, _cid, patch):
        state["campaign_status"] = patch.get("status")

    async def _audit(_client, _event):
        return None

    async def _delete(_client, _cid):
        state["deleted"] = True

    async def _has_live(_client, _cid):
        return state["live"]

    async def _cancel(_client, _cid):
        return state["cancelled"]

    monkeypatch.setattr(db_campaigns, "get_campaign", _get_campaign)
    monkeypatch.setattr(db_campaigns, "get_campaign_personas", _get_personas)
    monkeypatch.setattr(db_campaigns, "update_campaign_persona_approval", _update_approval)
    monkeypatch.setattr(db_campaigns, "get_variants_for_campaign_persona", _get_variants)
    monkeypatch.setattr(db_campaigns, "set_post_variants_status", _set_status)
    monkeypatch.setattr(db_campaigns, "assign_scheduled_times", _assign_scheduled_times)
    monkeypatch.setattr(db_campaigns, "update_campaign", _update_campaign)
    monkeypatch.setattr(db_campaigns, "delete_campaign", _delete)
    monkeypatch.setattr(db_campaigns, "has_live_variants", _has_live)
    monkeypatch.setattr(db_campaigns, "cancel_scheduled_variants_for_campaign", _cancel)
    monkeypatch.setattr(db_audit, "insert_audit_event", _audit)

    tc = TestClient(main.app)
    tc.state = state  # type: ignore[attr-defined]
    return tc


def test_approve_all_schedules_and_marks_approved(client):
    res = client.post("/campaigns/camp-1/approve", json={})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "approved_count": 2}
    # both personas scheduled, campaign rolled to approved
    assert len(client.state["variants_scheduled"]) == 2
    assert client.state["campaign_status"] == "approved"


def test_approve_subset_leaves_pending(client):
    res = client.post("/campaigns/camp-1/approve", json={"persona_ids": ["p1"]})
    assert res.status_code == 200
    assert res.json()["approved_count"] == 1
    # p2 still pending → campaign not marked approved
    assert client.state["campaign_status"] is None


def test_approve_assigns_non_null_scheduled_at_to_every_variant(client):
    """Regression for the live bug: approving must set a non-null scheduled_at on
    every approved variant, else claim_due_variants never publishes them."""
    res = client.post("/campaigns/camp-1/approve", json={})
    assert res.status_code == 200
    # Both personas' variants (v-cp-1, v-cp-2) got a scheduled_at.
    assert set(client.state["scheduled_at"]) == {"v-cp-1", "v-cp-2"}
    assert all(ts for ts in client.state["scheduled_at"].values())


def test_approve_passes_campaign_window_to_scheduler(client):
    """When the campaign carries a brief window, it's forwarded to
    assign_scheduled_times so variants spread across the window."""
    client.state["campaign"]["window_start"] = "2026-08-01T00:00:00Z"
    client.state["campaign"]["window_end"] = "2026-08-07T00:00:00Z"
    res = client.post("/campaigns/camp-1/persona/p1/approve")
    assert res.status_code == 200
    from datetime import datetime

    ws, we = client.state["assign_windows"][0]
    assert ws == datetime.fromisoformat("2026-08-01T00:00:00+00:00")
    assert we == datetime.fromisoformat("2026-08-07T00:00:00+00:00")


def test_campaign_not_found(client, monkeypatch):
    async def _none(_client, _cid):
        return None

    monkeypatch.setattr(db_campaigns, "get_campaign", _none)
    res = client.post("/campaigns/camp-x/approve", json={})
    assert res.status_code == 404


def test_persona_approve(client):
    res = client.post("/campaigns/camp-1/persona/p1/approve")
    assert res.status_code == 200
    assert ("cp-1", "approved") in client.state["approvals"]


def test_persona_approve_unknown_persona(client):
    res = client.post("/campaigns/camp-1/persona/nope/approve")
    assert res.status_code == 404


def test_persona_reject_no_scheduling(client):
    res = client.post("/campaigns/camp-1/persona/p1/reject")
    assert res.status_code == 200
    assert ("cp-1", "rejected") in client.state["approvals"]
    assert client.state["variants_scheduled"] == []


def test_cancel_scheduled(client):
    client.state["cancelled"] = 3
    res = client.post("/campaigns/camp-1/cancel-scheduled")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "cancelled": 3}


def test_delete_ok(client):
    res = client.request("DELETE", "/campaigns/camp-1")
    assert res.status_code == 200
    assert client.state["deleted"] is True


def test_delete_blocked_by_live_variants(client):
    client.state["live"] = True
    res = client.request("DELETE", "/campaigns/camp-1")
    assert res.status_code == 409
    assert client.state["deleted"] is False
