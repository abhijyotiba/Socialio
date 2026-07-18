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


class MockResponse:
    def __init__(self, data):
        self.data = data


class MockClient:
    mock_invalid_persona = False
    mock_missing_prompt = False
    mock_no_connections = False
    mock_partial_success = False

    def table(self, table_name):
        self.table_name = table_name
        return self

    def select(self, select_fields):
        self.select_fields = select_fields
        return self

    def in_(self, field, values):
        self.field = field
        self.values = values
        return self

    async def execute(self):
        if self.table_name == "personas":
            if MockClient.mock_invalid_persona:
                return MockResponse([])
            return MockResponse([
                {"id": pid, "name": f"Persona {pid}", "workspace_id": "ws-1"}
                for pid in self.values
            ])
        elif self.table_name == "brand_configs":
            prompt = None if MockClient.mock_missing_prompt else "prompt"
            return MockResponse([
                {"persona_id": pid, "custom_system_prompt": prompt, "current_prompt_version_id": "pv-1"}
                for pid in self.values
            ])
        elif self.table_name == "social_connections":
            if MockClient.mock_no_connections:
                return MockResponse([])
            res_data = []
            for pid in self.values:
                if pid == "p2" and MockClient.mock_partial_success:
                    continue
                res_data.append({"persona_id": pid, "platform": "linkedin", "needs_reauth": False})
            return MockResponse(res_data)
        return MockResponse([])


@pytest.fixture
def client(monkeypatch):
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "tok"

    async def _rls(_token):
        return MockClient()

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

    # Capture the background coroutine WITHOUT scheduling it, so tests can assert
    # the route returns before generation runs (and doesn't await it in-request).
    captured: dict = {"coro": None}

    def _capture_create_task(coro):
        captured["coro"] = coro

        class _FakeTask:
            def cancel(self_inner):
                coro.close()

        return _FakeTask()

    monkeypatch.setattr(cr.asyncio, "create_task", _capture_create_task)

    test_client = TestClient(main.app)
    test_client.captured = captured  # type: ignore[attr-defined]
    return test_client


def _post(client, **overrides):
    payload = {"ingestion_job_id": "job-1", "persona_ids": ["p1"]}
    payload.update(overrides)
    return client.post("/campaigns", json=payload)


def test_immediate_return_status_generating(client):
    """The route validates + creates rows, then hands generation to a background
    task and returns { status: "generating" } immediately — without running the
    LLM pipeline in the request path."""
    summarize_calls = {"n": 0}
    orig_summarize = cr.analyze.summarize

    async def _tracking_summarize(title, text):
        summarize_calls["n"] += 1
        return await orig_summarize(title, text)

    cr.analyze.summarize = _tracking_summarize
    try:
        res = _post(client)
    finally:
        cr.analyze.summarize = orig_summarize

    assert res.status_code == 200
    body = res.json()
    assert body["campaign_id"] == "camp-1"
    assert body["status"] == "generating"
    assert "variants" not in body

    # Generation was deferred, not awaited in-request.
    assert summarize_calls["n"] == 0
    assert client.captured["coro"] is not None
    client.captured["coro"].close()


def test_fifty_persona_ids_accepted_and_deferred(client):
    """POST with the full 50-persona cap returns fast without awaiting the
    per-persona generation."""
    res = _post(client, persona_ids=[f"p{i}" for i in range(50)])
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "generating"
    assert client.captured["coro"] is not None
    client.captured["coro"].close()


def test_persona_cap_exceeded_rejected(client):
    res = _post(client, persona_ids=[f"p{i}" for i in range(51)])
    assert res.status_code == 400  # Pydantic Field(max_length=50) → 400 handler


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


def test_invalid_persona(client):
    MockClient.mock_invalid_persona = True
    try:
        res = _post(client)
        assert res.status_code == 403
    finally:
        MockClient.mock_invalid_persona = False


def test_missing_brand_prompt(client):
    MockClient.mock_missing_prompt = True
    try:
        res = _post(client)
        assert res.status_code == 409
    finally:
        MockClient.mock_missing_prompt = False
