from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_hmac, verify_user
from db import posting_schedules as db_schedules
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user

router = APIRouter()


class CreateSlotRequest(BaseModel):
    platform: str
    hour: int = Field(ge=0, le=23)
    minute: int
    days_of_week: list[int]
    timezone: str = Field(min_length=1)
    persona_id: str | None = None


@router.post("/schedule-slots")
async def create_schedule_slot(
    req: CreateSlotRequest, request: Request
) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    if req.platform not in ("linkedin", "x"):
        raise HTTPException(
            status_code=400, detail="platform must be 'linkedin' or 'x'"
        )

    if req.minute not in (0, 30):
        raise HTTPException(status_code=400, detail="minute must be 0 or 30")

    for day in req.days_of_week:
        if not (0 <= day <= 6):
            raise HTTPException(
                status_code=400, detail="days_of_week elements must be 0-6"
            )

    try:
        slot = await db_schedules.create_schedule_slot(
            client,
            {
                "workspace_id": workspace_id,
                "platform": req.platform,
                "hour": req.hour,
                "minute": req.minute,
                "days_of_week": req.days_of_week,
                "timezone": req.timezone,
                "persona_id": req.persona_id,
            },
        )
        return slot
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/schedule-slots/{slot_id}")
async def delete_schedule_slot(slot_id: str, request: Request) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    await db_schedules.delete_schedule_slot(client, slot_id, workspace_id)
    return {"deleted": True}
