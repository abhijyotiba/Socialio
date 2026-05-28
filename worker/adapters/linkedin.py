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


async def get_post_metrics(
    access_token: str, author_urn: str, platform_post_id: str
) -> dict:
    url = (
        "https://api.linkedin.com/rest/organizationalEntityShareStatistics"
        f"?q=organizationalEntity&organizationalEntity={author_urn}"
        f"&shares[0]={platform_post_id}"
    )
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
                "LinkedIn-Version": "202304",
            },
        )
    if res.status_code >= 400:
        if res.status_code == 404:
            raise PublishError("POST_DELETED", "POST_DELETED")
        raise PublishError(
            f"LinkedIn metrics fetch failed: {res.status_code}",
            classify_error(res.status_code),
        )
    stats = (res.json().get("elements") or [{}])[0].get("totalShareStatistics", {})
    return {
        "impressions": stats.get("impressionCount", 0),
        "likes": stats.get("likeCount", 0),
        "comments": stats.get("commentCount", 0),
        "shares": stats.get("shareCount", 0),
    }


async def refresh_token(refresh_token_value: str) -> dict:
    import os

    params = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token_value,
        "client_id": os.environ["LINKEDIN_CLIENT_ID"],
        "client_secret": os.environ["LINKEDIN_CLIENT_SECRET"],
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=params,
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn token refresh failed: {res.status_code}",
            classify_error(res.status_code),
        )
    data = res.json()
    return {
        "access_token": data["access_token"],
        "expires_in": data.get("expires_in"),
        "new_refresh_token": data.get("refresh_token"),
    }


async def exchange_code_for_tokens(code: str) -> dict:
    import os

    params = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": os.environ["LINKEDIN_REDIRECT_URI"],
        "client_id": os.environ["LINKEDIN_CLIENT_ID"],
        "client_secret": os.environ["LINKEDIN_CLIENT_SECRET"],
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=params,
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn token exchange failed: {res.status_code}",
            classify_error(res.status_code),
        )
    data = res.json()
    return {
        "access_token": data["access_token"],
        "expires_in": data.get("expires_in"),
        "refresh_token": data.get("refresh_token"),
        "refresh_token_expires_in": data.get("refresh_token_expires_in"),
    }


def build_authorization_url(state: str) -> str:
    import os
    from urllib.parse import urlencode

    params = {
        "response_type": "code",
        "client_id": os.environ["LINKEDIN_CLIENT_ID"],
        "redirect_uri": os.environ["LINKEDIN_REDIRECT_URI"],
        "scope": "openid profile email w_member_social",
        "state": state,
    }
    return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"


async def get_user_info(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if res.status_code >= 400:
        raise PublishError(
            f"LinkedIn userinfo fetch failed: {res.status_code}",
            classify_error(res.status_code),
        )
    return res.json()

