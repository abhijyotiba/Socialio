import pytest
from fastapi.testclient import TestClient

import main
import routes.campaigns as cr
from db import audit_events as db_audit
from db import brand_configs as db_brand
from db import campaigns as db_campaigns
from db import ingestion as db_ingestion
from db import personas as db_personas
from db import posts as db_posts
from db import social_connections as db_connections


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

    async def _count(_client, _ws, _window):
        return 0

    async def _get_job(_client, _jid):
        return {
            "id": "job-1",
            "stage": "done",
            "extracted_title": "T",
            "extracted_text": "Some source text",
            "source_type": "url",
        }

    async def _get_persona(_client, pid):
        return {"id": pid, "name": f"Persona {pid}", "workspace_id": "ws-1"}

    async def _brand(_client, _pid):
        return {"custom_system_prompt": "prompt", "current_prompt_version_id": "pv-1"}

    async def _connections(_client, _pid):
        return [{"platform": "linkedin", "needs_reauth": False}]

    async def _create_campaign(_client, _values):
        return {"id": "camp-1"}

    async def _create_cps(_client, _cid, persona_ids):
        return [{"id": f"cp-{pid}", "persona_id": pid} for pid in persona_ids]

    async def _create_content_item(_client, _values):
        return {"id": "ci-1"}

    async def _create_post_variants(_client, variants):
        return [
            {"id": f"v{i}", "platform": v["platform"], "body": v["body"]}
            for i, v in enumerate(variants)
        ]

    async def _noop(*a, **k):
        return None

    async def _summarize(_title, _text):
        return "summary"

    async def _generate_variants(**kwargs):
        return [{"platform": p, "body": f"post for {p}"} for p in kwargs["platforms"]]

    monkeypatch.setattr(db_campaigns, "count_recent_campaigns", _count)
    monkeypatch.setattr(db_ingestion, "get_job", _get_job)
    monkeypatch.setattr(db_personas, "get_persona", _get_persona)
    monkeypatch.setattr(db_brand, "get_brand_config_for_persona", _brand)
    monkeypatch.setattr(db_connections, "get_connections_for_persona", _connections)
    monkeypatch.setattr(db_campaigns, "create_campaign", _create_campaign)
    monkeypatch.setattr(db_campaigns, "create_campaign_personas", _create_cps)
    monkeypatch.setattr(db_campaigns, "set_campaign_persona_error", _noop)
    monkeypatch.setattr(db_campaigns, "create_campaign_persona_variants", _noop)
    monkeypatch.setattr(db_campaigns, "update_campaign", _noop)
    monkeypatch.setattr(db_posts, "create_content_item", _create_content_item)
    monkeypatch.setattr(db_posts, "create_post_variants", _create_post_variants)
    monkeypatch.setattr(db_audit, "insert_audit_event", _noop)
    monkeypatch.setattr(cr.analyze, "summarize", _summarize)
    monkeypatch.setattr(cr.gen_pipeline, "generate_variants", _generate_variants)

    return TestClient(main.app)


def _post(client, **overrides):
    payload = {"ingestion_job_id": "job-1", "persona_ids": ["p1"]}
    payload.update(overrides)
    return client.post("/campaigns", json=payload)


def test_happy_path(client):
    res = _post(client)
    assert res.status_code == 200
    body = res.json()
    assert body["campaign_id"] == "camp-1"
    assert body["status"] == "pending_approval"
    assert len(body["variants"]) == 1
    assert body["variants"][0]["persona_name"] == "Persona p1"
    assert body["variants"][0]["platform"] == "linkedin"


def test_rate_limit(client, monkeypatch):
    async def _count(_client, _ws, _window):
        return 2

    monkeypatch.setattr(db_campaigns, "count_recent_campaigns", _count)
    res = _post(client)
    assert res.status_code == 429
    assert "per minute" in res.json()["error"]


def test_job_not_ready(client, monkeypatch):
    async def _get_job(_client, _jid):
        return {"id": "job-1", "stage": "scraping", "source_type": "url"}

    monkeypatch.setattr(db_ingestion, "get_job", _get_job)
    res = _post(client)
    assert res.status_code == 409


def test_invalid_persona(client, monkeypatch):
    async def _get_persona(_client, _pid):
        return None

    monkeypatch.setattr(db_personas, "get_persona", _get_persona)
    res = _post(client)
    assert res.status_code == 403


def test_missing_brand_prompt(client, monkeypatch):
    async def _brand(_client, _pid):
        return {"custom_system_prompt": None}

    monkeypatch.setattr(db_brand, "get_brand_config_for_persona", _brand)
    res = _post(client)
    assert res.status_code == 409


def test_all_personas_fail_returns_502_with_campaign_id(client, monkeypatch):
    async def _no_connections(_client, _pid):
        return []

    monkeypatch.setattr(db_connections, "get_connections_for_persona", _no_connections)
    res = _post(client)
    assert res.status_code == 502
    body = res.json()
    assert body["campaign_id"] == "camp-1"
    assert "error" in body


def test_partial_success(client, monkeypatch):
    async def _connections(_client, pid):
        return [] if pid == "p2" else [{"platform": "linkedin", "needs_reauth": False}]

    monkeypatch.setattr(db_connections, "get_connections_for_persona", _connections)
    res = _post(client, persona_ids=["p1", "p2"])
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "generation_partial"
    assert len(body["variants"]) == 1
