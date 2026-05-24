import time

import jwt
import pytest
from fastapi import HTTPException

from config import settings
import auth

SECRET = "unit-test-jwt-secret-padded-to-32-bytes-minimum"


@pytest.fixture(autouse=True)
def _hs256_secret(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)


def _token(claims: dict, secret: str = SECRET, alg: str = "HS256") -> str:
    base = {"sub": "user-1", "aud": "authenticated", "exp": int(time.time()) + 3600}
    base.update(claims)
    return jwt.encode(base, secret, algorithm=alg)


def test_valid_hs256_token_returns_claims():
    claims = auth._decode_token(_token({"sub": "user-42"}))
    assert claims["sub"] == "user-42"


def test_expired_token_rejected():
    token = _token({"exp": int(time.time()) - 10})
    with pytest.raises(HTTPException) as exc:
        auth._decode_token(token)
    assert exc.value.status_code == 401


def test_wrong_audience_rejected():
    token = _token({"aud": "anon"})
    with pytest.raises(HTTPException) as exc:
        auth._decode_token(token)
    assert exc.value.status_code == 401


def test_bad_signature_rejected():
    token = _token({}, secret="a-different-secret")
    with pytest.raises(HTTPException) as exc:
        auth._decode_token(token)
    assert exc.value.status_code == 401


def test_malformed_token_rejected():
    with pytest.raises(HTTPException) as exc:
        auth._decode_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_hs256_without_configured_secret_rejected(monkeypatch):
    token = _token({})
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")
    with pytest.raises(HTTPException) as exc:
        auth._decode_token(token)
    assert exc.value.status_code == 401


class _FakeRequest:
    def __init__(self, headers: dict):
        self.headers = headers


def test_bearer_token_extracted():
    req = _FakeRequest({"Authorization": "Bearer abc.def.ghi"})
    assert auth._bearer_token(req) == "abc.def.ghi"


def test_missing_bearer_rejected():
    with pytest.raises(HTTPException) as exc:
        auth._bearer_token(_FakeRequest({}))
    assert exc.value.status_code == 401


def test_non_bearer_scheme_rejected():
    with pytest.raises(HTTPException) as exc:
        auth._bearer_token(_FakeRequest({"Authorization": "Basic xyz"}))
    assert exc.value.status_code == 401
