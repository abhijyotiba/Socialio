import httpx

from adapters.base import PublishError

_TIMEOUT = httpx.Timeout(30.0)


def classify_error(status: int) -> str:
    if status == 401:
        return "TOKEN_EXPIRED"
    if status == 429:
        return "RATE_LIMITED"
    if status == 403:
        return "CONTENT_POLICY"
    if status >= 500:
        return "SERVER_ERROR"
    return "UNKNOWN"


def build_tweet_body(text: str, media_ids: list[str] | None = None) -> dict:
    body: dict = {"text": text}
    if media_ids:
        body["media"] = {"media_ids": media_ids}
    return body


async def upload_media(access_token: str, image_bytes: bytes, mime_type: str) -> str:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://upload.twitter.com/1.1/media/upload.json",
            headers={"Authorization": f"Bearer {access_token}"},
            files={"media": ("upload", image_bytes, mime_type)},
        )
    if res.status_code >= 400:
        raise PublishError(
            f"X media upload failed: {res.status_code}",
            classify_error(res.status_code),
        )
    return res.json()["media_id_string"]


async def publish_tweet(
    access_token: str, text: str, media_ids: list[str] | None = None
) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://api.twitter.com/2/tweets",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=build_tweet_body(text, media_ids),
        )
    if res.status_code >= 400:
        raise PublishError(
            f"X publish failed: {res.status_code}",
            classify_error(res.status_code),
        )
    post_id = res.json()["data"]["id"]
    return {
        "platform_post_id": post_id,
        "platform_post_url": f"https://x.com/i/web/status/{post_id}",
    }


async def get_post_metrics(access_token: str, platform_post_id: str) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.get(
            f"https://api.twitter.com/2/tweets/{platform_post_id}"
            "?tweet.fields=public_metrics",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if res.status_code >= 400:
        if res.status_code == 404:
            raise PublishError("POST_DELETED", "POST_DELETED")
        raise PublishError(
            f"X metrics fetch failed: {res.status_code}",
            classify_error(res.status_code),
        )
    metrics = (res.json().get("data") or {}).get("public_metrics", {})
    return {
        "impressions": metrics.get("impression_count", 0),
        "likes": metrics.get("like_count", 0),
        "comments": metrics.get("reply_count", 0),
        "shares": metrics.get("retweet_count", 0),
    }


async def refresh_token(refresh_token_value: str) -> dict:
    import base64
    import os

    creds = base64.b64encode(
        f"{os.environ['X_CLIENT_ID']}:{os.environ['X_CLIENT_SECRET']}".encode()
    ).decode()
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(
            "https://api.twitter.com/2/oauth2/token",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {creds}",
            },
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token_value,
            },
        )
    if res.status_code >= 400:
        raise PublishError(
            f"X token refresh failed: {res.status_code}",
            classify_error(res.status_code),
        )
    data = res.json()
    return {
        "access_token": data["access_token"],
        "expires_in": data.get("expires_in"),
        "new_refresh_token": data.get("refresh_token"),
    }
