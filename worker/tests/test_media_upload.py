import pytest
from fastapi.testclient import TestClient
import main
import routes.media as mr
from db import media_assets as db_media

@pytest.fixture
def client(monkeypatch):
    async def _ok_hmac(_request, _body):
        return None

    async def _user(_request):
        return {"sub": "user-1"}, "tok"

    async def _rls(_token):
        return object()

    async def _ws(_client, _uid):
        return "ws-1"

    monkeypatch.setattr(mr, "verify_hmac", _ok_hmac)
    monkeypatch.setattr(mr, "verify_user", _user)
    monkeypatch.setattr(mr, "rls_client", _rls)
    monkeypatch.setattr(mr, "get_workspace_id_for_user", _ws)

    def _mock_upload(file_stream, **kwargs):
        return {
            "secure_url": "https://cdn/uploaded_file.png",
            "public_id": "uploaded_file_id",
            "format": "png",
            "bytes": 5000,
            "width": 100,
            "height": 100,
        }
    monkeypatch.setattr(mr.cloudinary.uploader, "upload", _mock_upload)

    async def _mock_db_insert(client, workspace_id, cloudinary_url, cloudinary_id, format_name, bytes_size, width, height):
        return {
            "id": "asset-1",
            "workspace_id": workspace_id,
            "ingestion_job_id": None,
            "cloudinary_url": cloudinary_url,
            "cloudinary_id": cloudinary_id,
            "resource_type": "image",
            "format": format_name,
            "bytes": bytes_size,
            "width": width,
            "height": height,
        }
    monkeypatch.setattr(db_media, "create_user_upload_media_asset", _mock_db_insert)

    return TestClient(main.app)

def test_media_upload_happy_path(client):
    dummy_data = b"dummy file content"
    res = client.post(
        "/media/upload",
        content=dummy_data,
        headers={"Content-Type": "image/png"}
    )
    assert res.status_code == 200
    data = res.json()
    assert "asset" in data
    assert data["asset"]["id"] == "asset-1"
    assert data["asset"]["cloudinary_url"] == "https://cdn/uploaded_file.png"
    assert data["asset"]["format"] == "png"
    assert data["asset"]["bytes"] == 5000

def test_media_upload_missing_content_type(client):
    dummy_data = b"dummy file content"
    res = client.post(
        "/media/upload",
        content=dummy_data,
        headers={"Content-Type": ""}
    )
    assert res.status_code == 400
    assert "Missing Content-Type" in res.json()["error"]
