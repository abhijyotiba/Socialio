import pytest
from fastapi.testclient import TestClient

import main
import routes.cron as cron_route
from adapters.base import PublishError
from cron import jobs


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _aret(value):
    async def _f(*_a, **_k):
        return value

    return _f


SVC = object()


# --------------------------------------------------------------------------
# publish-due
# --------------------------------------------------------------------------


@pytest.fixture
def publish_due_mocks(monkeypatch):
    monkeypatch.setattr(jobs.db_campaigns, "fail_zombie_campaigns", _aret([]))
    monkeypatch.setattr(jobs.db_posts, "sweep_stuck_publishing", _aret(0))
    monkeypatch.setattr(jobs.db_attempts, "has_successful_attempt", _aret(False))
    monkeypatch.setattr(jobs.db_attempts, "get_latest_attempt", _aret(None))
    monkeypatch.setattr(jobs.db_attempts, "create_publish_attempt", _aret({"id": "a1"}))
    monkeypatch.setattr(jobs.db_attempts, "update_publish_attempt", _aret(None))
    monkeypatch.setattr(jobs.db_posts, "update_post_variant", _aret(None))
    monkeypatch.setattr(
        jobs.db_connections,
        "get_social_connection_for_persona",
        _aret(
            {
                "platform_user_id": "li-1",
                "needs_reauth": False,
                "access_token_vault_id": "v1",
            }
        ),
    )
    monkeypatch.setattr(jobs.vault, "read_secret", _aret("token"))
    monkeypatch.setattr(jobs.db_media, "get_variant_media_urls", _aret([]))
    monkeypatch.setattr(jobs, "upload_media_for_platform", _aret([]))
    monkeypatch.setattr(
        jobs.linkedin,
        "publish_post",
        _aret({"platform_post_id": "p1", "platform_post_url": "u1"}),
    )


@pytest.mark.asyncio
async def test_publish_due_publishes_claimed(monkeypatch, publish_due_mocks):
    variant = {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "linkedin",
        "body": "hi",
    }
    monkeypatch.setattr(jobs.db_posts, "claim_due_variants", _aret([variant]))
    result = await jobs.run_publish_due(SVC)
    assert result == {"swept": 0, "attempted": 1, "succeeded": 1, "failed": 0}


@pytest.mark.asyncio
async def test_publish_due_idempotent_shortcut(monkeypatch, publish_due_mocks):
    variant = {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "linkedin",
        "body": "hi",
    }
    monkeypatch.setattr(jobs.db_posts, "claim_due_variants", _aret([variant]))
    monkeypatch.setattr(jobs.db_attempts, "has_successful_attempt", _aret(True))
    result = await jobs.run_publish_due(SVC)
    assert result["succeeded"] == 1 and result["failed"] == 0


@pytest.mark.asyncio
async def test_publish_due_failure_counts(monkeypatch, publish_due_mocks):
    variant = {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "linkedin",
        "body": "hi",
    }
    monkeypatch.setattr(jobs.db_posts, "claim_due_variants", _aret([variant]))

    async def _boom(*_a, **_k):
        raise PublishError("LinkedIn publish failed: 500", "SERVER_ERROR")

    monkeypatch.setattr(jobs.linkedin, "publish_post", _boom)
    result = await jobs.run_publish_due(SVC)
    assert result == {"swept": 0, "attempted": 1, "succeeded": 0, "failed": 1}


# --------------------------------------------------------------------------
# pull-metrics
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_metrics_syncs(monkeypatch):
    variant = {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "x",
        "platform_post_id": "tweet-1",
    }
    monkeypatch.setattr(jobs.db_posts, "get_published_variants_for_metrics", _aret([variant]))
    monkeypatch.setattr(
        jobs.db_connections,
        "get_social_connection_for_persona",
        _aret({"needs_reauth": False, "access_token_vault_id": "v1"}),
    )
    monkeypatch.setattr(jobs.vault, "read_secret", _aret("token"))
    monkeypatch.setattr(
        jobs.x,
        "get_post_metrics",
        _aret({"impressions": 5, "likes": 2, "comments": 1, "shares": 0}),
    )
    monkeypatch.setattr(jobs.db_metrics, "upsert_post_metrics", _aret(None))
    result = await jobs.run_pull_metrics(SVC)
    assert result == {"checked": 1, "synced": 1, "failed": 0}


@pytest.mark.asyncio
async def test_pull_metrics_post_deleted_not_failure(monkeypatch):
    variant = {
        "id": "v1",
        "workspace_id": "ws1",
        "persona_id": "pp1",
        "platform": "x",
        "platform_post_id": "tweet-1",
    }
    monkeypatch.setattr(jobs.db_posts, "get_published_variants_for_metrics", _aret([variant]))
    monkeypatch.setattr(
        jobs.db_connections,
        "get_social_connection_for_persona",
        _aret({"needs_reauth": False, "access_token_vault_id": "v1"}),
    )
    monkeypatch.setattr(jobs.vault, "read_secret", _aret("token"))

    async def _deleted(*_a, **_k):
        raise PublishError("POST_DELETED", "POST_DELETED")

    monkeypatch.setattr(jobs.x, "get_post_metrics", _deleted)
    result = await jobs.run_pull_metrics(SVC)
    assert result == {"checked": 1, "synced": 0, "failed": 0}


# --------------------------------------------------------------------------
# token-expiry-check
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_token_expiry_refreshes(monkeypatch):
    conn = {
        "id": "c1",
        "platform": "x",
        "workspace_id": "ws1",
        "refresh_token_vault_id": "r1",
    }
    monkeypatch.setattr(jobs.db_connections, "get_expiring_connections", _aret([conn]))
    monkeypatch.setattr(jobs.vault, "read_secret", _aret("refresh-token"))
    monkeypatch.setattr(
        jobs.x,
        "refresh_token",
        _aret({"access_token": "new", "expires_in": 3600, "new_refresh_token": None}),
    )
    monkeypatch.setattr(jobs.vault, "create_secret", _aret("new-vault-id"))
    monkeypatch.setattr(jobs.db_connections, "update_connection_tokens", _aret(None))
    result = await jobs.run_token_expiry_check(SVC)
    assert result == {"checked": 1, "refreshed": 1, "flagged": 0}


@pytest.mark.asyncio
async def test_token_expiry_flags_when_no_refresh_token(monkeypatch):
    conn = {"id": "c1", "platform": "x", "workspace_id": "ws1", "refresh_token_vault_id": None}
    monkeypatch.setattr(jobs.db_connections, "get_expiring_connections", _aret([conn]))
    monkeypatch.setattr(jobs.db_connections, "flag_needs_reauth", _aret(None))
    result = await jobs.run_token_expiry_check(SVC)
    assert result == {"checked": 1, "refreshed": 0, "flagged": 1}


# --------------------------------------------------------------------------
# cleanup-orphaned-media
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cleanup_deletes_orphans(monkeypatch):
    orphans = [{"id": "m1", "cloudinary_id": "c1"}, {"id": "m2", "cloudinary_id": "c2"}]
    monkeypatch.setattr(jobs.db_media, "get_orphaned_media_assets", _aret(orphans))
    monkeypatch.setattr(jobs.cloudinary, "delete_asset", _aret(None))
    deleted_ids = {}

    async def _del(_svc, ids):
        deleted_ids["ids"] = ids

    monkeypatch.setattr(jobs.db_media, "delete_media_assets_by_ids", _del)
    result = await jobs.run_cleanup_orphaned_media(SVC)
    assert result == {"deleted": 2, "failed": 0}
    assert set(deleted_ids["ids"]) == {"m1", "m2"}


@pytest.mark.asyncio
async def test_cleanup_partial_failure_keeps_failed_rows(monkeypatch):
    orphans = [{"id": "m1", "cloudinary_id": "c1"}, {"id": "m2", "cloudinary_id": "c2"}]
    monkeypatch.setattr(jobs.db_media, "get_orphaned_media_assets", _aret(orphans))

    async def _del_asset(public_id):
        if public_id == "c2":
            raise RuntimeError("cloudinary down")

    monkeypatch.setattr(jobs.cloudinary, "delete_asset", _del_asset)
    deleted_ids = {}

    async def _del(_svc, ids):
        deleted_ids["ids"] = ids

    monkeypatch.setattr(jobs.db_media, "delete_media_assets_by_ids", _del)
    result = await jobs.run_cleanup_orphaned_media(SVC)
    assert result == {"deleted": 1, "failed": 1}
    assert deleted_ids["ids"] == ["m1"]


# --------------------------------------------------------------------------
# route auth
# --------------------------------------------------------------------------


def test_cron_requires_bearer(monkeypatch):
    monkeypatch.setattr(cron_route, "service_client", _aret(SVC))
    monkeypatch.setattr(cron_route.jobs, "run_publish_due", _aret({"ok": True}))
    tc = TestClient(main.app)

    assert tc.post("/cron/publish-due").status_code == 401
    assert (
        tc.post("/cron/publish-due", headers={"Authorization": "Bearer wrong"}).status_code
        == 401
    )
    ok = tc.post(
        "/cron/publish-due", headers={"Authorization": "Bearer test-cron-secret"}
    )
    assert ok.status_code == 200 and ok.json() == {"ok": True}
