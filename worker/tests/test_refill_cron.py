import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_refill_renders_planned_cells_and_creates_variants():
    cadence = {
        "id": "cad1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "posts_per_week": 3, "autopilot_enabled": True,
        "active": True, "low_reservoir_threshold": 5,
    }
    planned_cell = {
        "id": "cell1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "format": "hot_take", "angle": "expert",
        "idea_id": "idea1",
        "content_ideas": {"essence": "e", "source_quote": "q"},
    }
    svc = AsyncMock()

    with patch("cron.jobs.db_cadences.list_active_cadences", new_callable=AsyncMock) as mock_cad, \
         patch("cron.jobs.db_cells.count_reservoir", new_callable=AsyncMock) as mock_count, \
         patch("cron.jobs.db_cells.next_planned_cells", new_callable=AsyncMock) as mock_next, \
         patch("cron.jobs.db_brand.get_brand_config_for_persona", new_callable=AsyncMock) as mock_brand, \
         patch("cron.jobs.render_cell", new_callable=AsyncMock) as mock_render, \
         patch("cron.jobs.db_posts.create_content_item", new_callable=AsyncMock) as mock_ci, \
         patch("cron.jobs.db_posts.create_post_variants", new_callable=AsyncMock) as mock_cv, \
         patch("cron.jobs.db_cells.mark_cell_rendered", new_callable=AsyncMock) as mock_mark, \
         patch("cron.jobs.db_cadences.mark_low_nudge_sent", new_callable=AsyncMock):
        mock_cad.return_value = [cadence]
        mock_count.return_value = 10              # above threshold, no nudge
        mock_next.return_value = [planned_cell]
        mock_brand.return_value = {"custom_system_prompt": "brand"}
        mock_render.return_value = "rendered body"
        mock_ci.return_value = {"id": "ci1"}
        mock_cv.return_value = [{"id": "v1"}]

        from cron.jobs import run_refill_and_schedule
        result = await run_refill_and_schedule(svc, per_cadence_limit=1)

    mock_render.assert_awaited_once()
    mock_cv.assert_awaited_once()
    created = mock_cv.call_args[0][1][0]
    assert created["body"] == "rendered body"
    mock_mark.assert_awaited_once_with(svc, "cell1")
    assert result["rendered"] == 1


@pytest.mark.asyncio
async def test_refill_sets_pending_approval_when_autopilot_off():
    cadence = {
        "id": "cad1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "posts_per_week": 3, "autopilot_enabled": False,
        "active": True, "low_reservoir_threshold": 5,
    }
    planned_cell = {
        "id": "cell1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "format": "how_to", "angle": "beginner",
        "idea_id": "idea1", "content_ideas": {"essence": "e", "source_quote": "q"},
    }
    svc = AsyncMock()
    with patch("cron.jobs.db_cadences.list_active_cadences", new_callable=AsyncMock) as mock_cad, \
         patch("cron.jobs.db_cells.count_reservoir", new_callable=AsyncMock) as mock_count, \
         patch("cron.jobs.db_cells.next_planned_cells", new_callable=AsyncMock) as mock_next, \
         patch("cron.jobs.db_brand.get_brand_config_for_persona", new_callable=AsyncMock) as mock_brand, \
         patch("cron.jobs.render_cell", new_callable=AsyncMock) as mock_render, \
         patch("cron.jobs.db_posts.create_content_item", new_callable=AsyncMock), \
         patch("cron.jobs.db_posts.create_post_variants", new_callable=AsyncMock) as mock_cv, \
         patch("cron.jobs.db_cells.mark_cell_rendered", new_callable=AsyncMock):
        mock_cad.return_value = [cadence]
        mock_count.return_value = 10
        mock_next.return_value = [planned_cell]
        mock_brand.return_value = {"custom_system_prompt": "brand"}
        mock_render.return_value = "body"
        mock_cv.return_value = [{"id": "v1"}]
        from cron.jobs import run_refill_and_schedule
        await run_refill_and_schedule(svc, per_cadence_limit=1)
    created = mock_cv.call_args[0][1][0]
    assert created["status"] == "pending_approval"


@pytest.mark.asyncio
async def test_refill_fires_nudge_when_below_threshold():
    cadence = {
        "id": "cad1", "workspace_id": "w1", "persona_id": "p1",
        "platform": "linkedin", "posts_per_week": 3, "autopilot_enabled": True,
        "active": True, "low_reservoir_threshold": 5, "last_low_nudge_at": None,
    }
    svc = AsyncMock()
    with patch("cron.jobs.db_cadences.list_active_cadences", new_callable=AsyncMock) as mock_cad, \
         patch("cron.jobs.db_cells.count_reservoir", new_callable=AsyncMock) as mock_count, \
         patch("cron.jobs.db_cells.next_planned_cells", new_callable=AsyncMock) as mock_next, \
         patch("cron.jobs.db_audit.insert_audit_event", new_callable=AsyncMock) as mock_audit, \
         patch("cron.jobs.db_cadences.mark_low_nudge_sent", new_callable=AsyncMock) as mock_mark_nudge:
        mock_cad.return_value = [cadence]
        mock_count.return_value = 2               # below threshold of 5
        mock_next.return_value = []               # nothing to render
        from cron.jobs import run_refill_and_schedule
        result = await run_refill_and_schedule(svc, per_cadence_limit=5)
    mock_audit.assert_awaited_once()
    event = mock_audit.call_args[0][1]
    assert event["event_type"] == "cadence.low_reservoir"
    mock_mark_nudge.assert_awaited_once()
    assert result["nudged"] == 1
