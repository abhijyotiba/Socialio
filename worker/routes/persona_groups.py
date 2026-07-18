"""Account (persona) group CRUD + membership — Task 7.

Thin mutation routes: HMAC + user JWT, RLS client, workspace-scoped. All writes
go through the worker (CLAUDE.md); the web app proxies to these endpoints.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_hmac, verify_user
from db import persona_groups as db_groups
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user

router = APIRouter()


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    persona_ids: list[str] = Field(default_factory=list, max_length=50)


class RenameGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class SetMembersRequest(BaseModel):
    persona_ids: list[str] = Field(default_factory=list, max_length=50)


async def _authorize(request: Request, body: bytes) -> tuple[Any, str]:
    await verify_hmac(request, body)
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")
    return client, workspace_id


@router.post("/account-groups", status_code=201)
async def create_group(req: CreateGroupRequest, request: Request) -> dict:
    client, workspace_id = await _authorize(request, await request.body())
    try:
        group = await db_groups.create_group(client, workspace_id, req.name.strip())
    except Exception as exc:  # unique(workspace_id, name) violation, etc.
        raise HTTPException(status_code=409, detail="Group name already exists") from exc
    if req.persona_ids:
        await db_groups.add_members(client, group["id"], req.persona_ids)
    group["persona_ids"] = list(dict.fromkeys(req.persona_ids))
    return {"group": group}


@router.patch("/account-groups/{group_id}")
async def rename_group(
    group_id: str, req: RenameGroupRequest, request: Request
) -> dict:
    client, _workspace_id = await _authorize(request, await request.body())
    try:
        updated = await db_groups.rename_group(client, group_id, req.name.strip())
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Group name already exists") from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.delete("/account-groups/{group_id}")
async def delete_group(group_id: str, request: Request) -> dict:
    client, _workspace_id = await _authorize(request, await request.body())
    await db_groups.delete_group(client, group_id)
    return {"ok": True}


@router.put("/account-groups/{group_id}/members")
async def set_members(
    group_id: str, req: SetMembersRequest, request: Request
) -> dict:
    """Replace a group's membership with exactly the supplied persona_ids."""
    client, _workspace_id = await _authorize(request, await request.body())
    await db_groups.set_members(client, group_id, req.persona_ids)
    return {"ok": True, "persona_ids": list(dict.fromkeys(req.persona_ids))}
