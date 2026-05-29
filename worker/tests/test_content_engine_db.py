import pytest
from unittest.mock import AsyncMock, MagicMock


def _fake_client_returning(data):
    """Builds a chainable mock matching the supabase async client surface used
    by our db helpers: client.table(...).insert(...).execute() etc."""
    execute = AsyncMock(return_value=MagicMock(data=data, count=None))
    chain = MagicMock()
    # Every chained method returns the same chain; execute is awaited at the end.
    for m in ("table", "insert", "upsert", "select", "update", "delete", "eq",
              "in_", "order", "limit", "is_", "not_", "gte", "lt", "maybe_single"):
        getattr(chain, m).return_value = chain
    chain.execute = execute
    client = MagicMock()
    client.table.return_value = chain
    return client, chain


# ─── content_ideas ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_content_ideas_inserts_rows():
    client, chain = _fake_client_returning([{"id": "i1"}, {"id": "i2"}])
    from db.content_ideas import create_content_ideas
    rows = await create_content_ideas(client, [{"essence": "a"}, {"essence": "b"}])
    assert len(rows) == 2
    chain.insert.assert_called_once()


@pytest.mark.asyncio
async def test_create_content_ideas_empty_is_noop():
    client, chain = _fake_client_returning([])
    from db.content_ideas import create_content_ideas
    rows = await create_content_ideas(client, [])
    assert rows == []
    chain.insert.assert_not_called()


# ─── content_cells ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_materialize_cells_inserts_with_ignore_duplicates():
    client, chain = _fake_client_returning([{"id": "c1"}])
    from db.content_cells import materialize_cells
    rows = await materialize_cells(client, [{"matrix_cell_hash": "h1", "status": "planned"}])
    assert len(rows) == 1
    # upsert (not plain insert) so dedup collisions are ignored, not errors
    assert chain.upsert.called


@pytest.mark.asyncio
async def test_materialize_cells_empty_is_noop():
    client, chain = _fake_client_returning([])
    from db.content_cells import materialize_cells
    rows = await materialize_cells(client, [])
    assert rows == []
    chain.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_count_reservoir_returns_count():
    client, chain = _fake_client_returning(None)
    chain.execute = AsyncMock(return_value=MagicMock(data=None, count=7))
    from db.content_cells import count_reservoir
    n = await count_reservoir(client, "persona-1", "linkedin")
    assert n == 7


@pytest.mark.asyncio
async def test_next_planned_cells_orders_oldest_first():
    client, chain = _fake_client_returning([{"id": "c1"}, {"id": "c2"}])
    from db.content_cells import next_planned_cells
    rows = await next_planned_cells(client, "persona-1", "linkedin", limit=2)
    assert len(rows) == 2
    chain.order.assert_called()  # ordered query


@pytest.mark.asyncio
async def test_mark_cell_rendered_updates_status():
    client, chain = _fake_client_returning([{"id": "c1"}])
    from db.content_cells import mark_cell_rendered
    await mark_cell_rendered(client, "c1")
    chain.update.assert_called_once()
    chain.eq.assert_any_call("id", "c1")


# ─── content_cadences ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upsert_cadence_uses_persona_platform_conflict():
    client, chain = _fake_client_returning([{"id": "cad1"}])
    from db.content_cadences import upsert_cadence
    row = await upsert_cadence(client, {
        "workspace_id": "w1", "persona_id": "p1", "platform": "linkedin",
        "posts_per_week": 5, "autopilot_enabled": True,
    })
    assert row["id"] == "cad1"
    assert chain.upsert.called


@pytest.mark.asyncio
async def test_list_active_cadences_filters_active():
    client, chain = _fake_client_returning([{"id": "cad1", "active": True}])
    from db.content_cadences import list_active_cadences
    rows = await list_active_cadences(client)
    assert len(rows) == 1
    chain.eq.assert_any_call("active", True)


@pytest.mark.asyncio
async def test_list_cadences_for_workspace_filters_by_workspace():
    client, chain = _fake_client_returning([{"id": "cad1"}])
    from db.content_cadences import list_cadences_for_workspace
    rows = await list_cadences_for_workspace(client, "w1")
    assert len(rows) == 1
    chain.eq.assert_any_call("workspace_id", "w1")


@pytest.mark.asyncio
async def test_mark_low_nudge_sent_updates_timestamp():
    client, chain = _fake_client_returning([{"id": "cad1"}])
    from db.content_cadences import mark_low_nudge_sent
    await mark_low_nudge_sent(client, "cad1")
    chain.update.assert_called_once()
    chain.eq.assert_any_call("id", "cad1")
