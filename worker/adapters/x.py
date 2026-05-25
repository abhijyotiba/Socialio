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
