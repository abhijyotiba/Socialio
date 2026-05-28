from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import structlog

from auth import verify_hmac, verify_user
from adapters import linkedin, x
from db import personas as db_personas
from db import social_connections as db_connections
from db.client import rls_client, service_client
from db.workspaces import get_workspace_id_for_user
from security import vault

log = structlog.get_logger()
router = APIRouter()


class LinkedInCallbackRequest(BaseModel):
    code: str
    persona_id: str


class XCallbackRequest(BaseModel):
    code: str
    persona_id: str
    code_verifier: str


@router.get("/oauth/linkedin/auth-url")
async def linkedin_auth_url(persona_id: str, request: Request):
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    persona = await db_personas.get_persona(client, persona_id)
    if not persona or persona["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Persona mismatch")

    import secrets
    state_rand = secrets.token_hex(16)
    state = f"{state_rand}:{persona_id}"
    auth_url = linkedin.build_authorization_url(state)

    return {"auth_url": auth_url, "state": state}


@router.get("/oauth/x/auth-url")
async def x_auth_url(persona_id: str, request: Request):
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    persona = await db_personas.get_persona(client, persona_id)
    if not persona or persona["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Persona mismatch")

    import secrets
    import hashlib
    import base64

    state_rand = secrets.token_hex(16)
    state = f"{state_rand}:{persona_id}"
    
    code_verifier_bytes = secrets.token_bytes(32)
    code_verifier = base64.urlsafe_b64encode(code_verifier_bytes).decode('utf-8').rstrip('=')
    
    challenge_bytes = hashlib.sha256(code_verifier.encode('utf-8')).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).decode('utf-8').rstrip('=')

    auth_url = x.build_authorization_url(state, code_challenge)

    return {
        "auth_url": auth_url,
        "state": state,
        "code_verifier": code_verifier
    }


@router.post("/oauth/linkedin/callback")
async def linkedin_callback(req: LinkedInCallbackRequest, request: Request):
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    persona = await db_personas.get_persona(client, req.persona_id)
    if not persona or persona["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Persona mismatch")

    try:
        tokens = await linkedin.exchange_code_for_tokens(req.code)
    except Exception as err:
        log.error("linkedin_token_exchange_failed", error=str(err))
        raise HTTPException(status_code=502, detail="LinkedIn token exchange failed") from err

    admin = await service_client()

    try:
        access_vault_id = await vault.create_secret(
            admin,
            tokens["access_token"],
            f"linkedin:access:{workspace_id}:{req.persona_id}",
        )

        refresh_vault_id = None
        if tokens.get("refresh_token"):
            refresh_vault_id = await vault.create_secret(
                admin,
                tokens["refresh_token"],
                f"linkedin:refresh:{workspace_id}:{req.persona_id}",
            )
    except Exception as err:
        log.error("linkedin_vault_write_failed", error=str(err))
        raise HTTPException(status_code=500, detail="Failed to save secrets in vault") from err

    platform_user_id = None
    platform_username = None
    try:
        info = await linkedin.get_user_info(tokens["access_token"])
        platform_user_id = info.get("sub")
        platform_username = info.get("name") or info.get("email")
    except Exception as err:
        log.warn("linkedin_user_info_failed", error=str(err))
        # Non-fatal error

    expires_in = tokens.get("expires_in")
    token_expires_at = (
        (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
        if expires_in
        else None
    )

    try:
        await db_connections.upsert_social_connection(
            admin,
            {
                "workspace_id": workspace_id,
                "persona_id": req.persona_id,
                "platform": "linkedin",
                "platform_user_id": platform_user_id,
                "platform_username": platform_username,
                "access_token_vault_id": access_vault_id,
                "refresh_token_vault_id": refresh_vault_id,
                "token_expires_at": token_expires_at,
                "needs_reauth": False,
            },
        )
    except Exception as err:
        log.error("linkedin_db_upsert_failed", error=str(err))
        raise HTTPException(status_code=500, detail="Failed to save connection record") from err

    return {"success": True}


@router.post("/oauth/x/callback")
async def x_callback(req: XCallbackRequest, request: Request):
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    persona = await db_personas.get_persona(client, req.persona_id)
    if not persona or persona["workspace_id"] != workspace_id:
        raise HTTPException(status_code=403, detail="Persona mismatch")

    try:
        tokens = await x.exchange_code_for_tokens(req.code, req.code_verifier)
    except Exception as err:
        log.error("x_token_exchange_failed", error=str(err))
        raise HTTPException(status_code=502, detail="X token exchange failed") from err

    admin = await service_client()

    try:
        access_vault_id = await vault.create_secret(
            admin,
            tokens["access_token"],
            f"x:access:{workspace_id}:{req.persona_id}",
        )

        refresh_vault_id = None
        if tokens.get("refresh_token"):
            refresh_vault_id = await vault.create_secret(
                admin,
                tokens["refresh_token"],
                f"x:refresh:{workspace_id}:{req.persona_id}",
            )
    except Exception as err:
        log.error("x_vault_write_failed", error=str(err))
        raise HTTPException(status_code=500, detail="Failed to save secrets in vault") from err

    platform_user_id = None
    platform_username = None
    try:
        info = await x.get_user_info(tokens["access_token"])
        data = info.get("data") or {}
        platform_user_id = data.get("id")
        platform_username = data.get("username")
    except Exception as err:
        log.warn("x_user_info_failed", error=str(err))
        # Non-fatal error

    expires_in = tokens.get("expires_in")
    token_expires_at = (
        (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
        if expires_in
        else None
    )

    needs_reauth = not tokens.get("refresh_token")

    try:
        await db_connections.upsert_social_connection(
            admin,
            {
                "workspace_id": workspace_id,
                "persona_id": req.persona_id,
                "platform": "x",
                "platform_user_id": platform_user_id,
                "platform_username": platform_username,
                "access_token_vault_id": access_vault_id,
                "refresh_token_vault_id": refresh_vault_id,
                "token_expires_at": token_expires_at,
                "needs_reauth": needs_reauth,
            },
        )
    except Exception as err:
        log.error("x_db_upsert_failed", error=str(err))
        raise HTTPException(status_code=500, detail="Failed to save connection record") from err

    return {"success": True}
