import pytest
from fastapi.testclient import TestClient
import main
import routes.oauth as ro
from db import personas as db_personas
from db import social_connections as db_connections
from adapters import linkedin, x
from security import vault

@pytest.fixture
def client(monkeypatch):
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "tok"

    async def _rls(_token):
        return object()

    async def _service():
        return object()

    async def _ws(_client, _uid):
        return "ws-1"

    async def _get_persona(_client, persona_id):
        if persona_id == "invalid-persona":
            return None
        return {"id": persona_id, "workspace_id": "ws-1"}

    monkeypatch.setattr(ro, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(ro, "verify_user", _user)
    monkeypatch.setattr(ro, "rls_client", _rls)
    monkeypatch.setattr(ro, "service_client", _service)
    monkeypatch.setattr(ro, "get_workspace_id_for_user", _ws)
    monkeypatch.setattr(db_personas, "get_persona", _get_persona)

    # Mock token exchange & user info
    async def _li_exchange(_code):
        return {"access_token": "li-access", "expires_in": 3600, "refresh_token": "li-refresh"}
    monkeypatch.setattr(linkedin, "exchange_code_for_tokens", _li_exchange)

    async def _li_info(_token):
        return {"sub": "li-sub-1", "name": "LinkedIn User"}
    monkeypatch.setattr(linkedin, "get_user_info", _li_info)

    async def _x_exchange(_code, _verifier):
        return {"access_token": "x-access", "expires_in": 7200}
    monkeypatch.setattr(x, "exchange_code_for_tokens", _x_exchange)

    async def _x_info(_token):
        return {"data": {"id": "x-sub-1", "username": "xuser"}}
    monkeypatch.setattr(x, "get_user_info", _x_info)

    # Mock vault
    async def _mock_vault_create(_client, secret, name):
        return f"vault-{secret}"
    monkeypatch.setattr(vault, "create_secret", _mock_vault_create)

    # Mock upsert
    async def _mock_upsert(_client, values):
        return values
    monkeypatch.setattr(db_connections, "upsert_social_connection", _mock_upsert)

    return TestClient(main.app)

def test_linkedin_callback_happy_path(client):
    res = client.post(
        "/oauth/linkedin/callback",
        json={"code": "dummy-code", "persona_id": "persona-123"}
    )
    assert res.status_code == 200
    assert res.json() == {"success": True}

def test_linkedin_callback_invalid_persona(client):
    res = client.post(
        "/oauth/linkedin/callback",
        json={"code": "dummy-code", "persona_id": "invalid-persona"}
    )
    assert res.status_code == 403
    assert "Persona mismatch" in res.json()["error"]

def test_x_callback_happy_path(client):
    res = client.post(
        "/oauth/x/callback",
        json={"code": "dummy-code", "persona_id": "persona-123", "code_verifier": "dummy-verifier"}
    )
    assert res.status_code == 200
    assert res.json() == {"success": True}
