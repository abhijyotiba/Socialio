import httpx
import pytest

from adapters import linkedin as linkedin_fn
from adapters import x as x_fn
from adapters import platforms
from adapters.platforms import get_adapter, all_platforms
from adapters.platforms.base import PlatformAdapter, PlatformCapabilities


def test_all_platforms():
    assert all_platforms() == ["linkedin", "x"]


def test_get_adapter_returns_platform_adapter():
    assert isinstance(get_adapter("linkedin"), PlatformAdapter)
    assert isinstance(get_adapter("x"), PlatformAdapter)


def test_get_adapter_bogus_raises():
    with pytest.raises(KeyError):
        get_adapter("bogus")


def test_linkedin_capabilities():
    caps = get_adapter("linkedin").capabilities()
    assert isinstance(caps, PlatformCapabilities)
    assert caps.slug == "linkedin"
    assert caps.char_limit == 3000
    assert caps.daily_limit == 20
    assert caps.uses_pkce is False
    assert caps.media_upload_style == "register_upload"
    assert caps.supports_idempotency_key is True
    assert "LinkedIn" in caps.generation_hint


def test_x_capabilities():
    caps = get_adapter("x").capabilities()
    assert isinstance(caps, PlatformCapabilities)
    assert caps.slug == "x"
    assert caps.char_limit == 280
    assert caps.daily_limit == 50
    assert caps.uses_pkce is True
    assert caps.media_upload_style == "single_step"
    assert caps.supports_idempotency_key is False
    assert "X/Twitter" in caps.generation_hint


@pytest.mark.parametrize("status", [401, 429, 400, 403, 500])
def test_classify_error_matches_legacy(status):
    assert get_adapter("linkedin").classify_error(status) == (
        linkedin_fn.classify_error(status)
    )
    assert get_adapter("x").classify_error(status) == x_fn.classify_error(status)


def test_build_author_urn():
    assert get_adapter("linkedin").build_author_urn("li-123") == (
        "urn:li:person:li-123"
    )
    assert get_adapter("x").build_author_urn("x-123") is None


def test_reexports():
    assert platforms.PlatformAdapter is PlatformAdapter
    assert platforms.PlatformCapabilities is PlatformCapabilities


class _StubResponse:
    def __init__(self, status_code=200, json_data=None, headers=None, content=b""):
        self.status_code = status_code
        self._json = json_data or {}
        self.headers = headers or {}
        self.content = content

    def json(self):
        return self._json


class _StubClient:
    """Records outbound calls and returns queued stub responses so no real HTTP
    is performed."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _record(self, method, url, **kwargs):
        self.calls.append((method, url))
        return self._responses.pop(0)

    async def get(self, url, **kwargs):
        return await self._record("GET", url, **kwargs)

    async def post(self, url, **kwargs):
        return await self._record("POST", url, **kwargs)

    async def put(self, url, **kwargs):
        return await self._record("PUT", url, **kwargs)


def _patch_httpx(monkeypatch, responses):
    client = _StubClient(responses)
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: client)
    return client


async def test_linkedin_get_user_info_mapped(monkeypatch):
    _patch_httpx(
        monkeypatch,
        [_StubResponse(json_data={"sub": "li-sub", "name": "Jane"})],
    )
    result = await get_adapter("linkedin").get_user_info("token")
    assert result == {"platform_user_id": "li-sub", "platform_username": "Jane"}


async def test_x_get_user_info_mapped(monkeypatch):
    _patch_httpx(
        monkeypatch,
        [_StubResponse(json_data={"data": {"id": "x-id", "username": "jane"}})],
    )
    result = await get_adapter("x").get_user_info("token")
    assert result == {"platform_user_id": "x-id", "platform_username": "jane"}


async def test_linkedin_publish_delegates(monkeypatch):
    client = _patch_httpx(
        monkeypatch,
        [_StubResponse(status_code=201, headers={"x-restli-id": "urn:li:share:1"})],
    )
    result = await get_adapter("linkedin").publish(
        access_token="token",
        body="hello",
        idempotency_key="key-1",
        author_urn="urn:li:person:li-123",
    )
    assert result["platform_post_id"] == "urn:li:share:1"
    assert "ugcPosts" in client.calls[0][1]


async def test_x_publish_delegates(monkeypatch):
    client = _patch_httpx(
        monkeypatch,
        [_StubResponse(json_data={"data": {"id": "tweet-1"}})],
    )
    result = await get_adapter("x").publish(access_token="token", body="hi")
    assert result["platform_post_id"] == "tweet-1"
    assert "tweets" in client.calls[0][1]


async def test_x_upload_media_single_step(monkeypatch):
    client = _patch_httpx(
        monkeypatch,
        [_StubResponse(json_data={"media_id_string": "media-9"})],
    )
    media_id = await get_adapter("x").upload_media(
        "token", b"bytes", "image/png"
    )
    assert media_id == "media-9"
    assert len(client.calls) == 1


async def test_linkedin_upload_media_register_upload(monkeypatch):
    client = _patch_httpx(
        monkeypatch,
        [
            _StubResponse(
                json_data={
                    "value": {
                        "asset": "urn:li:asset:1",
                        "uploadMechanism": {
                            "com.linkedin.digitalmedia.uploading."
                            "MediaUploadHttpRequest": {
                                "uploadUrl": "https://upload.example/1"
                            }
                        },
                    }
                }
            ),
            _StubResponse(status_code=201),
        ],
    )
    asset = await get_adapter("linkedin").upload_media(
        "token", b"bytes", "image/png", author_urn="urn:li:person:li-123"
    )
    assert asset == "urn:li:asset:1"
    # register_upload + upload_bytes = two outbound calls
    assert len(client.calls) == 2
