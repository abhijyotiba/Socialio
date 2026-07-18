"""Task 5 — background campaign generation.

Covers the immediate-return contract of POST /campaigns (the LLM pipeline is
handed to a background task and NOT awaited in the request path) and the
terminal-status rolling logic of `_run_campaign_generation`.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

import main
import routes.campaigns as cr
from db import audit_events as db_audit
from db import campaigns as db_campaigns
from db import ingestion as db_ingestion
from db import posts as db_posts


class MockResponse:
    def __init__(self, data):
        self.data = data


class MockClient:
    """Batch-read mock: personas / brand_configs / social_connections."""

    def table(self, table_name):
        self.table_name = table_name
        return self

    def select(self, _fields):
        return self

    def in_(self, _field, values):
        self.values = values
        return self

    async def execute(self):
        if self.table_name == "personas":
            return MockResponse(
                [{"id": pid, "name": f"Persona {pid}"} for pid in self.values]
            )
        if self.table_name == "brand_configs":
            return MockResponse(
                [
                    {
                        "persona_id": pid,
                        "custom_system_prompt": "prompt",
                        "current_prompt_version_id": "pv-1",
                    }
                    for pid in self.values
                ]
            )
        if self.table_name == "social_connections":
            return MockResponse(
                [
                    {"persona_id": pid, "platform": "linkedin", "needs_reauth": False}
                    for pid in self.values
                ]
            )
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

    async def _create_campaign(_client, _values):
        return {"id": "camp-1"}

    async def _create_cps(_client, _cid, persona_ids):
        return [{"id": f"cp-{pid}", "persona_id": pid} for pid in persona_ids]

    monkeypatch.setattr(db_campaigns, "count_recent_campaigns", _count)
    monkeypatch.setattr(db_ingestion, "get_job", _get_job)
    monkeypatch.setattr(db_campaigns, "create_campaign", _create_campaign)
    monkeypatch.setattr(db_campaigns, "create_campaign_personas", _create_cps)

    # Capture the background coroutine without scheduling it — so we can assert
    # the route returned before generation ran, then close it to avoid warnings.
    captured: dict = {"coro": None}

    def _capture(coro):
        captured["coro"] = coro

        class _FakeTask:
            def cancel(self_inner):
                coro.close()

        return _FakeTask()

    monkeypatch.setattr(cr.asyncio, "create_task", _capture)

    tc = TestClient(main.app)
    tc.captured = captured  # type: ignore[attr-defined]
    return tc


def _post(client, persona_ids):
    return client.post(
        "/campaigns",
        json={"ingestion_job_id": "job-1", "persona_ids": persona_ids},
    )


def test_fifty_personas_return_generating_without_awaiting(client, monkeypatch):
    """POST with 50 persona_ids returns { status: 'generating' } fast, and the
    LLM pipeline (summarize) is NOT invoked in the request path."""
    summarize_calls = {"n": 0}

    async def _tracking_summarize(_title, _text):
        summarize_calls["n"] += 1
        return "summary"

    # If summarize were called in-request this counter would be non-zero.
    monkeypatch.setattr(cr.analyze, "summarize", _tracking_summarize)

    res = _post(client, [f"p{i}" for i in range(50)])

    assert res.status_code == 200
    body = res.json()
    assert body["campaign_id"] == "camp-1"
    assert body["status"] == "generating"
    assert "variants" not in body

    # The heavy work was deferred to the captured background coroutine.
    assert summarize_calls["n"] == 0
    assert client.captured["coro"] is not None
    client.captured["coro"].close()


# ─── _run_campaign_generation terminal-status rolling ────────────────────────


def _bg_kwargs(persona_ids, connections_by_persona=None):
    return dict(
        token="tok",
        campaign_id="camp-1",
        workspace_id="ws-1",
        ingestion_job_id="job-1",
        persona_ids=persona_ids,
        brand_configs=[
            {"custom_system_prompt": "prompt", "current_prompt_version_id": "pv-1"}
            for _ in persona_ids
        ],
        connections_by_persona=(
            connections_by_persona
            if connections_by_persona is not None
            else [
                [{"platform": "linkedin", "needs_reauth": False}] for _ in persona_ids
            ]
        ),
        cp_by_persona={
            pid: {"id": f"cp-{pid}", "persona_id": pid} for pid in persona_ids
        },
        requested_platforms=None,
        user_angle=None,
        effective_title="T",
        effective_text="Some source text",
    )


def _patch_pipeline(monkeypatch, updates, errored=None):
    async def _rls(_token):
        return object()

    async def _summarize(_t, _x):
        return "summary"

    async def _generate_variants(**kwargs):
        return [{"platform": p, "body": f"post {p}"} for p in kwargs["platforms"]]

    async def _create_content_item(_client, _values):
        return {"id": "ci-1"}

    async def _create_post_variants(_client, variants):
        return [
            {"id": f"v{i}", "platform": v["platform"], "body": v["body"]}
            for i, v in enumerate(variants)
        ]

    async def _noop(*a, **k):
        return None

    async def _update_campaign(_client, _cid, patch):
        updates.append(patch)

    async def _set_error(_client, cp_id, err):
        if errored is not None:
            errored.append((cp_id, err))

    monkeypatch.setattr(cr, "rls_client", _rls)
    monkeypatch.setattr(cr.analyze, "summarize", _summarize)
    monkeypatch.setattr(cr.gen_pipeline, "generate_variants", _generate_variants)
    monkeypatch.setattr(db_posts, "create_content_item", _create_content_item)
    monkeypatch.setattr(db_posts, "create_post_variants", _create_post_variants)
    monkeypatch.setattr(db_campaigns, "create_campaign_persona_variants", _noop)
    monkeypatch.setattr(db_campaigns, "set_campaign_persona_error", _set_error)
    monkeypatch.setattr(db_campaigns, "update_campaign", _update_campaign)
    monkeypatch.setattr(db_audit, "insert_audit_event", _noop)


def test_all_success_rolls_pending_approval(monkeypatch):
    updates = []
    _patch_pipeline(monkeypatch, updates)
    asyncio.run(cr._run_campaign_generation(**_bg_kwargs(["p1", "p2"])))
    assert updates[-1]["status"] == "pending_approval"


def test_mixed_rolls_generation_partial(monkeypatch):
    updates, errored = [], []
    _patch_pipeline(monkeypatch, updates, errored)
    # p2 has no connected platforms → it errors; p1 succeeds.
    kwargs = _bg_kwargs(
        ["p1", "p2"],
        connections_by_persona=[
            [{"platform": "linkedin", "needs_reauth": False}],
            [],
        ],
    )
    asyncio.run(cr._run_campaign_generation(**kwargs))
    assert updates[-1]["status"] == "generation_partial"
    assert len(errored) == 1


def test_all_fail_rolls_failed(monkeypatch):
    updates = []
    _patch_pipeline(monkeypatch, updates)
    kwargs = _bg_kwargs(["p1", "p2"], connections_by_persona=[[], []])
    asyncio.run(cr._run_campaign_generation(**kwargs))
    assert updates[-1]["status"] == "failed"
    assert updates[-1]["failure_code"] == "ALL_PERSONAS_FAILED"
