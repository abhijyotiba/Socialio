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
        "audit_events": [],
        # variant -> campaign_persona mapping used by the variant-scoped routes.
        "variant_map": {
            "v-cp-1-a": {"campaign_persona_id": "cp-1", "persona_id": "p1"},
            "v-cp-1-b": {"campaign_persona_id": "cp-1", "persona_id": "p1"},
            "v-cp-2-a": {"campaign_persona_id": "cp-2", "persona_id": "p2"},
        },
        # per-campaign_persona variant statuses (drives the persona roll-up).
        "cp_variant_statuses": {
            "cp-1": ["pending_approval", "pending_approval"],
            "cp-2": ["pending_approval"],
        },
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

    async def _audit(_client, event):
        state["audit_events"].append(event)
        return None

    async def _map_variants(_client, _cid, post_variant_ids):
        return [
            {"post_variant_id": vid, **state["variant_map"][vid]}
            for vid in post_variant_ids
            if vid in state["variant_map"]
        ]

    async def _cp_statuses(_client, cp_id):
        return state["cp_variant_statuses"].get(cp_id, [])

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
    monkeypatch.setattr(db_campaigns, "map_variants_to_campaign_personas", _map_variants)
    monkeypatch.setattr(
        db_campaigns, "get_variant_statuses_for_campaign_persona", _cp_statuses
    )
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


def test_bulk_approve_schedules_only_selected_variants(client):
    """Variant-scoped bulk-approve must set scheduled_at on ONLY the selected
    variants, not every variant of their personas (regression for the
    over-approval bug where selecting 2 of a persona's 5 approved all 5)."""
    res = client.post(
        "/campaigns/camp-1/bulk-approve",
        json={"post_variant_ids": ["v-cp-1-a"]},
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True, "approved_count": 1}
    # Only the one selected variant got a scheduled_at — not v-cp-1-b.
    assert set(client.state["scheduled_at"]) == {"v-cp-1-a"}
    assert all(ts for ts in client.state["scheduled_at"].values())
    # cp-1 still has a pending variant → persona NOT rolled to approved.
    assert ("cp-1", "approved") not in client.state["approvals"]


def test_bulk_approve_rolls_persona_when_all_variants_scheduled(client):
    """When the selection covers every remaining variant of a persona, that
    persona's approval_status rolls to 'approved'."""
    client.state["cp_variant_statuses"]["cp-1"] = ["scheduled", "scheduled"]
    res = client.post(
        "/campaigns/camp-1/bulk-approve",
        json={"post_variant_ids": ["v-cp-1-a", "v-cp-1-b"]},
    )
    assert res.status_code == 200
    assert set(client.state["scheduled_at"]) == {"v-cp-1-a", "v-cp-1-b"}
    assert ("cp-1", "approved") in client.state["approvals"]
    # Audit entity_id is the campaign_persona id, persona_id is carried through.
    approved_events = [
        e
        for e in client.state["audit_events"]
        if e["event_type"] == "campaign_persona.approved"
    ]
    assert approved_events and approved_events[0]["entity_id"] == "cp-1"
    assert approved_events[0]["persona_id"] == "p1"


def test_bulk_approve_requires_variant_ids(client):
    res = client.post("/campaigns/camp-1/bulk-approve", json={"post_variant_ids": []})
    assert res.status_code == 400


def test_bulk_approve_unknown_variants_404(client):
    res = client.post(
        "/campaigns/camp-1/bulk-approve", json={"post_variant_ids": ["nope"]}
    )
    assert res.status_code == 404


def test_bulk_schedule_assigns_distinct_times_to_selected(client):
    """Bulk-schedule routes through assign_scheduled_times so selected variants
    get distinct scheduled_at (not one shared instant)."""
    res = client.post(
        "/campaigns/camp-1/bulk-schedule",
        json={
            "post_variant_ids": ["v-cp-1-a", "v-cp-2-a"],
            "scheduled_at": "2026-08-01T09:00:00Z",
        },
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True, "scheduled_count": 2}
    assert set(client.state["scheduled_at"]) == {"v-cp-1-a", "v-cp-2-a"}


def test_bulk_schedule_requires_variant_ids(client):
    res = client.post("/campaigns/camp-1/bulk-schedule", json={"post_variant_ids": []})
    assert res.status_code == 400
    res = client.request("DELETE", "/campaigns/camp-1")
    assert res.status_code == 200
    assert client.state["deleted"] is True


def test_delete_blocked_by_live_variants(client):
    client.state["live"] = True
    res = client.request("DELETE", "/campaigns/camp-1")
    assert res.status_code == 409
    assert client.state["deleted"] is False
