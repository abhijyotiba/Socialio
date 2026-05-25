import pytest
from fastapi.testclient import TestClient

import main
import routes.brand as br
from db import brand_configs as db_brand
from db import personas as db_personas
from db import prompt_versions as db_prompts


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

    monkeypatch.setattr(br, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(br, "verify_user", _user)
    monkeypatch.setattr(br, "rls_client", _rls)
    monkeypatch.setattr(br, "get_workspace_id_for_user", _ws)

    async def _default_persona(_client, _ws):
        return {"id": "p-default"}

    async def _create_pv(_client, _ws, _prompt, _user, source="manual"):
        return {"id": "pv-1", "version_number": 3}

    async def _upsert(_client, values):
        return {"current_prompt_version_id": values["current_prompt_version_id"]}

    async def _existing(_client, _pid):
        return {"brand_name": "Acme", "tone_tags": ["bold"], "industry": "tech", "website_url": None}

    async def _set_voice(_client, _pid, _profile):
        return None

    monkeypatch.setattr(db_personas, "get_default_persona", _default_persona)
    monkeypatch.setattr(db_prompts, "create_prompt_version", _create_pv)
    monkeypatch.setattr(db_brand, "upsert_brand_config", _upsert)
    monkeypatch.setattr(db_brand, "get_brand_config_for_persona", _existing)
    monkeypatch.setattr(db_brand, "set_voice_profile_for_persona", _set_voice)

    return TestClient(main.app)


# ─── /brand/config ───────────────────────────────────────────────────────────


def test_save_brand_config(client):
    res = client.post(
        "/brand/config",
        json={
            "brand_name": "Acme",
            "tone_tags": ["bold", "concise"],
            "system_prompt": "You are Acme's voice.",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["version_number"] == 3
    assert body["current_prompt_version_id"] == "pv-1"


def test_save_brand_config_missing_name(client):
    res = client.post(
        "/brand/config", json={"tone_tags": [], "system_prompt": "x"}
    )
    assert res.status_code == 400


def test_save_brand_config_no_persona(client, monkeypatch):
    async def _none(_client, _ws):
        return None

    monkeypatch.setattr(db_personas, "get_default_persona", _none)
    res = client.post(
        "/brand/config",
        json={"brand_name": "Acme", "tone_tags": [], "system_prompt": "x"},
    )
    assert res.status_code == 400
    assert "persona" in res.json()["error"].lower()


# ─── /brand/voice-profile ────────────────────────────────────────────────────


def _samples(n=3):
    return ["x" * 50 for _ in range(n)]


def test_voice_profile_happy_path(client, monkeypatch):
    class _Profile:
        def model_dump(self, mode="json"):
            return {"tone": "bold"}

    async def _analyze(samples, platform_hints=None):
        return _Profile()

    def _render(profile, brand_name, tone_tags):
        return "RENDERED PROMPT"

    monkeypatch.setattr(br.vp, "analyze_samples", _analyze)
    monkeypatch.setattr(br.vp, "render_system_prompt", _render)

    res = client.post("/brand/voice-profile", json={"samples": _samples()})
    assert res.status_code == 200
    body = res.json()
    assert body["profile"] == {"tone": "bold"}
    assert body["system_prompt"] == "RENDERED PROMPT"
    assert body["version_number"] == 3


def test_voice_profile_too_few_samples(client):
    res = client.post("/brand/voice-profile", json={"samples": _samples(2)})
    assert res.status_code == 400


def test_voice_profile_sample_too_short(client):
    res = client.post(
        "/brand/voice-profile", json={"samples": ["short", "short", "short"]}
    )
    assert res.status_code == 400


def test_voice_profile_analysis_unvalidatable_422(client, monkeypatch):
    async def _analyze(samples, platform_hints=None):
        raise ValueError("bad json")

    monkeypatch.setattr(br.vp, "analyze_samples", _analyze)
    res = client.post("/brand/voice-profile", json={"samples": _samples()})
    assert res.status_code == 422


def test_voice_profile_provider_down_502(client, monkeypatch):
    async def _analyze(samples, platform_hints=None):
        raise RuntimeError("llm down")

    monkeypatch.setattr(br.vp, "analyze_samples", _analyze)
    res = client.post("/brand/voice-profile", json={"samples": _samples()})
    assert res.status_code == 502
