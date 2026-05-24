import pytest
from fastapi.testclient import TestClient

import main
import routes.posts as pr
from db import brand_configs as db_brand
from db import post_variant_revisions as db_revisions
from db import posts as db_posts


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

    async def _variant(_client, vid):
        return {
            "id": vid,
            "status": "draft",
            "persona_id": "p1",
            "platform": "linkedin",
            "body": "old body",
            "content_item_id": "ci-1",
        }

    async def _brand(_client, _pid):
        return {"custom_system_prompt": "prompt"}

    async def _summary(_client, _cid):
        return "summary"

    revisions = {"n": 0}

    async def _snapshot(_client, **kwargs):
        revisions["n"] += 1
        return {"revision_number": revisions["n"]}

    async def _update(_client, _vid, _patch):
        return None

    async def _regen(**kwargs):
        return "new regenerated body"

    monkeypatch.setattr(db_posts, "get_post_variant", _variant)
    monkeypatch.setattr(db_posts, "update_post_variant", _update)
    monkeypatch.setattr(db_posts, "get_content_item_summary", _summary)
    monkeypatch.setattr(db_brand, "get_brand_config_for_persona", _brand)
    monkeypatch.setattr(db_revisions, "snapshot_variant_body", _snapshot)
    monkeypatch.setattr(pr.regen_pipeline, "regenerate_variant", _regen)

    return TestClient(main.app)


def test_happy_path(client):
    res = client.post("/posts/v1/regenerate", json={"instruction": "make it punchier"})
    assert res.status_code == 200
    body = res.json()
    assert body["body"] == "new regenerated body"
    assert body["revision_number"] == 2  # baseline=1, new=2


def test_blank_instruction_rejected(client):
    res = client.post("/posts/v1/regenerate", json={"instruction": ""})
    assert res.status_code == 400


def test_variant_not_found(client, monkeypatch):
    async def _none(_client, _vid):
        return None

    monkeypatch.setattr(db_posts, "get_post_variant", _none)
    res = client.post("/posts/v1/regenerate", json={"instruction": "x"})
    assert res.status_code == 404


def test_non_editable_status_rejected(client, monkeypatch):
    async def _published(_client, vid):
        return {
            "id": vid,
            "status": "published",
            "persona_id": "p1",
            "platform": "linkedin",
            "body": "b",
            "content_item_id": "ci-1",
        }

    monkeypatch.setattr(db_posts, "get_post_variant", _published)
    res = client.post("/posts/v1/regenerate", json={"instruction": "x"})
    assert res.status_code == 409
    assert "published" in res.json()["error"]


def test_missing_brand_prompt_rejected(client, monkeypatch):
    async def _brand(_client, _pid):
        return None

    monkeypatch.setattr(db_brand, "get_brand_config_for_persona", _brand)
    res = client.post("/posts/v1/regenerate", json={"instruction": "x"})
    assert res.status_code == 400


def test_pipeline_failure_returns_502(client, monkeypatch):
    async def _boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(pr.regen_pipeline, "regenerate_variant", _boom)
    res = client.post("/posts/v1/regenerate", json={"instruction": "x"})
    assert res.status_code == 502
