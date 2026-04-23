import hashlib
import hmac

from fastapi import HTTPException, Request

from config import settings


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
