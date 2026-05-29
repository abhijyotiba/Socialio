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
