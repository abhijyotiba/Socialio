from fastapi import APIRouter, HTTPException, Request

from auth import verify_hmac, verify_user
from db import notifications as db_notifications
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user

router = APIRouter()


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, request: Request) -> dict:
    """Mark a single notification read. Thin worker-owned mutation under the
    user's RLS (HMAC + JWT like every other write)."""
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    updated = await db_notifications.mark_read(client, notification_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "read"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(request: Request) -> dict:
    """Mark every unread notification in the caller's workspace read."""
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    count = await db_notifications.mark_all_read(client, workspace_id)
    return {"status": "read", "count": count}
