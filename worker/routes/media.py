import io
import asyncio
from fastapi import APIRouter, HTTPException, Request
import structlog
import cloudinary
import cloudinary.uploader

from auth import verify_hmac, verify_user
from db import media_assets as db_media
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from config import settings

log = structlog.get_logger()
router = APIRouter()

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
)

@router.post("/media/upload")
async def upload_media(request: Request):
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    content_type = request.headers.get("Content-Type", "")
    if not content_type:
        raise HTTPException(status_code=400, detail="Missing Content-Type header")

    folder = f"user-uploads/{workspace_id}"

    try:
        file_stream = io.BytesIO(body)
        cloudinary_result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            file_stream,
            folder=folder,
            resource_type="auto",
        )
    except Exception as err:
        log.error("cloudinary_upload_failed", error=str(err))
        raise HTTPException(status_code=502, detail="Upload to Cloudinary failed") from err

    try:
        asset = await db_media.create_user_upload_media_asset(
            client=client,
            workspace_id=workspace_id,
            cloudinary_url=cloudinary_result["secure_url"],
            cloudinary_id=cloudinary_result["public_id"],
            format_name=cloudinary_result.get("format", ""),
            bytes_size=cloudinary_result.get("bytes", 0),
            width=cloudinary_result.get("width"),
            height=cloudinary_result.get("height"),
        )
    except Exception as err:
        log.error("save_media_asset_failed", error=str(err))
        raise HTTPException(status_code=500, detail="Failed to save asset record") from err

    return {"asset": asset}
