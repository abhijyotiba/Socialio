import httpx

from adapters.base import PublishError

_TIMEOUT = httpx.Timeout(30.0)


def classify_error(status: int) -> str:
    if status == 401:
        return "TOKEN_EXPIRED"
    if status == 429:
        return "RATE_LIMITED"
    if status in (400, 422):
        return "CONTENT_POLICY"
    if status >= 500:
        return "SERVER_ERROR"
    return "UNKNOWN"


def build_post_body(
    author_urn: str, text: str, media_urns: list[str] | None = None
) -> dict:
    share_content: dict = {
        "shareCommentary": {"text": text},
        "shareMediaCategory": "IMAGE" if media_urns else "NONE",
    }
    if media_urns:
        share_content["media"] = [
            {"status": "READY", "media": urn} for urn in media_urns
        ]
    return {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": share_content},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }


async def register_upload(
    access_token: str, author_urn: str, file_size: int
) -> tuple[str, str]:
    body = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": author_urn,
            "serviceRelationships": [
                {
                    "relationshipType": "OWNER",
                    "identifier": "urn:li:userGeneratedContent",
                }
            ],
            "supportedUploadMechanism": ["SYNCHRONOUS_UPLOAD"],
            "fileSize": file_size,
        }
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://api.linkedin.com/v2/assets?action=registerUpload",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json=body,
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn registerUpload failed: {res.status_code}",
            classify_error(res.status_code),
        )
    value = res.json()["value"]
    upload_url = value["uploadMechanism"][
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]["uploadUrl"]
    return upload_url, value["asset"]


async def upload_bytes(upload_url: str, image_bytes: bytes) -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.put(
            upload_url,
            content=image_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn binary upload failed: {res.status_code}",
            classify_error(res.status_code),
        )


async def publish_post(
    access_token: str,
    author_urn: str,
    text: str,
    idempotency_key: str,
    media_urns: list[str] | None = None,
) -> dict:
    body = build_post_body(author_urn, text, media_urns)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
                "X-RestLi-Request-Id": idempotency_key,
            },
            json=body,
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn publish failed: {res.status_code}",
            classify_error(res.status_code),
        )
    post_urn = res.headers.get("x-restli-id", "")
    return {
        "platform_post_id": post_urn,
        "platform_post_url": f"https://www.linkedin.com/feed/update/{post_urn}/",
    }
