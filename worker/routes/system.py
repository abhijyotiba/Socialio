from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Any
import structlog

from auth import verify_cron, verify_hmac
from db.client import service_client
from observability.metrics import snapshot

log = structlog.get_logger()
router = APIRouter()


@router.get("/system/metrics")
async def metrics_endpoint(request: Request):
    """Return in-process counters and latency histograms. Protected by cron_secret
    since these can expose load patterns. Resets on worker restart."""
    verify_cron(request)
    return snapshot()


class LogErrorRequest(BaseModel):
    source: str
    origin: str | None = None
    message: str
    stack: str | None = None
    metadata: dict[str, Any] | None = None

@router.post("/system/log-error")
async def log_error_endpoint(req: LogErrorRequest, request: Request):
    """
    Logs errors into the error_events table using the service role client.
    Unlike user interactions, errors don't require an active user JWT (e.g., logging a failed login).
    It only requires the HMAC signature to prove it came from Next.js.
    """
    body = await request.body()
    await verify_hmac(request, body)

    try:
        admin = await service_client()
        await admin.table("error_events").insert({
            "source": req.source,
            "origin": req.origin,
            "message": req.message[:1024],  # Max 1KB
            "stack": req.stack,
            "metadata": req.metadata or {}
        }).execute()
        return {"success": True}
    except Exception as exc:
        log.error("system_log_error_failed", error=str(exc))
        raise HTTPException(status_code=502, detail="Failed to log error") from exc
