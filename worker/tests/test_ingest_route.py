from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from db import ingestion as db_ingestion
from db import media_assets as db_media
import routes.ingest as ingest_route


@pytest.fixture
def client(monkeypatch):
    # Bypass transport auth — both are exercised in their own unit tests.
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "fake-token"

    async def _rls(_token):
        return object()  # sentinel; db calls are mocked below

    async def _ws(_client, _user_id):
        return "ws-1"

    monkeypatch.setattr(ingest_route, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(ingest_route, "verify_user", _user)
    monkeypatch.setattr(ingest_route, "rls_client", _rls)
    monkeypatch.setattr(ingest_route, "get_workspace_id_for_user", _ws)

    created = {}

    async def _create_job(_client, **kwargs):
        created.update(kwargs)
        return {"id": "job-1", **kwargs}

    async def _update_job(_client, _job_id, _patch):
        return None

    async def _count(_client, _ws, _window):
        return 0

    monkeypatch.setattr(db_ingestion, "create_job", _create_job)
    monkeypatch.setattr(db_ingestion, "update_job", _update_job)
    monkeypatch.setattr(db_ingestion, "count_recent_jobs", _count)
    monkeypatch.setattr(db_media, "create_media_assets", lambda *a, **k: None)

    return TestClient(main.app)


def test_text_passthrough(client):
    res = client.post("/ingest", json={"source_type": "text", "source_text": "hello"})
    assert res.status_code == 200
    body = res.json()
    assert body["job_id"] == "job-1"
    assert body["extracted_text"] == "hello"
    assert body["media"] == []


def test_missing_source_text_rejected(client):
    res = client.post("/ingest", json={"source_type": "text"})
    assert res.status_code == 400
    assert "error" in res.json()


def test_missing_source_url_rejected(client):
    res = client.post("/ingest", json={"source_type": "url"})
    assert res.status_code == 400


def test_linkedin_url_rejected(client):
    res = client.post(
        "/ingest",
        json={"source_type": "url", "source_url": "https://www.linkedin.com/feed/x"},
    )
    assert res.status_code == 422
    assert "LinkedIn" in res.json()["error"]


def test_rate_limit_per_minute(client, monkeypatch):
    async def _count(_client, _ws, window):
        return 2 if window == 60 else 0

    monkeypatch.setattr(db_ingestion, "count_recent_jobs", _count)
    res = client.post("/ingest", json={"source_type": "text", "source_text": "x"})
    assert res.status_code == 429
    assert "per minute" in res.json()["error"]


def test_url_happy_path_scrapes_and_writes_media(client, monkeypatch):
    async def _fetch(_url):
        return "<html><h1>Title</h1><p>Body</p></html>"

    def _parse(_html, base_url):
        return SimpleNamespace(title="Title", text="Body", media_urls=["http://img/1"])

    media_written = {}

    async def _upload(urls, ws):
        return [
            {
                "cloudinary_url": "https://cdn/x",
                "cloudinary_id": "x",
                "resource_type": "image",
                "format": "jpg",
                "bytes": 100,
                "width": 10,
                "height": 10,
            }
        ]

    async def _create_media(_client, ws, job_id, items):
        media_written["job_id"] = job_id
        media_written["count"] = len(items)

    monkeypatch.setattr(ingest_route.scrape, "fetch_html", _fetch)
    monkeypatch.setattr(ingest_route.extract, "parse", _parse)
    monkeypatch.setattr(ingest_route.upload, "to_cloudinary", _upload)
    monkeypatch.setattr(db_media, "create_media_assets", _create_media)

    res = client.post(
        "/ingest", json={"source_type": "url", "source_url": "https://example.com/a"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["extracted_title"] == "Title"
    assert body["extracted_text"] == "Body"
    assert len(body["media"]) == 1
    assert media_written == {"job_id": "job-1", "count": 1}
