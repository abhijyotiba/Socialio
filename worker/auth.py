import asyncio
import hashlib
import hmac
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from config import settings


def verify_cron(request: Request) -> None:
    """Authorize a call from an external scheduler. Any cron service can hit
    the /cron/* endpoints with `Authorization: Bearer $CRON_SECRET`."""
    secret = settings.cron_secret
    if not secret:
        raise HTTPException(status_code=401, detail="Cron not configured")
    header = request.headers.get("Authorization", "")
    expected = f"Bearer {secret}"
    if not hmac.compare_digest(header, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def verify_hmac(request: Request, body: bytes) -> None:
    sig_header = request.headers.get("X-Worker-Signature", "")
    if not sig_header.startswith("sha256="):
        raise HTTPException(status_code=401, detail="Missing signature")
    expected = "sha256=" + hmac.new(
        settings.worker_shared_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig_header, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[len("Bearer ") :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


@lru_cache
def _jwks_client() -> PyJWKClient:
    return PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


def _decode_token(token: str) -> dict:
    """Verify a Supabase access token and return its claims.

    Supports both asymmetric projects (RS256/ES256/EdDSA via JWKS) and legacy
    HS256-signed projects (via supabase_jwt_secret). Raises 401 on any failure.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Malformed token") from exc

    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise HTTPException(
                    status_code=401, detail="Token signing not configured"
                )
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        signing_key = _jwks_client().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            signing_key,
            algorithms=[alg],
            audience="authenticated",
        )
    except HTTPException:
        raise
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


async def verify_user(request: Request) -> tuple[dict, str]:
    """Authenticate the calling user from the forwarded Supabase JWT.

    Returns (claims, access_token). The access token is handed to the
    RLS-scoped DB client so Postgres enforces per-tenant isolation.
    JWKS verification does blocking I/O, so it runs in a worker thread.
    """
    token = _bearer_token(request)
    claims = await asyncio.to_thread(_decode_token, token)
    return claims, token
