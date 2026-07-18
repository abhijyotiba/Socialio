from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_hmac, verify_user
from db import personas as db_personas
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user

router = APIRouter()

PERSONA_HARD_CAP = 50
_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


class CreatePersonaRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    avatar_color: str | None = Field(default=None, pattern=_COLOR_PATTERN)


class PatchPersonaRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    avatar_color: str | None = Field(default=None, pattern=_COLOR_PATTERN)


async def _authorize(request: Request, body: bytes) -> tuple[Any, str]:
    await verify_hmac(request, body)
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")
    return client, workspace_id


@router.post("/personas", status_code=201)
async def create_persona(req: CreatePersonaRequest, request: Request) -> dict:
    client, workspace_id = await _authorize(request, await request.body())

    if await db_personas.count_personas(client, workspace_id) >= PERSONA_HARD_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"Workspace has reached the {PERSONA_HARD_CAP}-persona limit",
        )

    try:
        persona = await db_personas.create_persona(
            client, workspace_id, req.name, req.avatar_color
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"persona": persona}


@router.patch("/personas/{persona_id}")
async def update_persona(
    persona_id: str, req: PatchPersonaRequest, request: Request
) -> dict:
    client, _workspace_id = await _authorize(request, await request.body())

    persona = await db_personas.get_persona(client, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Not found")

    await db_personas.update_persona(
        client, persona_id, req.model_dump(exclude_none=True)
    )
    return {"ok": True}


@router.delete("/personas/{persona_id}")
async def delete_persona(persona_id: str, request: Request) -> dict:
    client, _workspace_id = await _authorize(request, await request.body())

    persona = await db_personas.get_persona(client, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        await db_personas.delete_persona(client, persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"ok": True}
