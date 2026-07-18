import pytest
from unittest.mock import AsyncMock, MagicMock


def _fake_client_returning(data):
    """Chainable mock matching the supabase async client surface used by the
    db helpers: client.table(...).select(...).eq(...).order(...).execute()."""
    execute = AsyncMock(return_value=MagicMock(data=data, count=None))
    chain = MagicMock()
    for m in ("table", "select", "eq", "order", "limit", "in_", "is_"):
        getattr(chain, m).return_value = chain
    chain.execute = execute
    client = MagicMock()
    client.table.return_value = chain
    return client, chain


@pytest.mark.asyncio
async def test_list_active_platforms_returns_slugs():
    client, chain = _fake_client_returning(
        [{"slug": "linkedin"}, {"slug": "x"}]
    )
    from db.platforms import list_active_platforms

    slugs = await list_active_platforms(client)
    assert slugs == ["linkedin", "x"]
    chain.eq.assert_called_with("is_active", True)


@pytest.mark.asyncio
async def test_list_active_platforms_empty():
    client, _ = _fake_client_returning([])
    from db.platforms import list_active_platforms

    slugs = await list_active_platforms(client)
    assert slugs == []


@pytest.mark.asyncio
async def test_list_active_platforms_none_data():
    client, _ = _fake_client_returning(None)
    from db.platforms import list_active_platforms

    slugs = await list_active_platforms(client)
    assert slugs == []


def _parse_seed_slugs(sql: str) -> list[str]:
    """Extract the slug values seeded into the platforms table."""
    import re

    m = re.search(
        r"INSERT INTO public\.platforms[\s\S]*?VALUES([\s\S]*?);", sql, re.I
    )
    assert m, "Could not find platforms seed INSERT"
    return re.findall(r"\(\s*'([^']+)'\s*,", m.group(1))


def test_list_active_platforms_agrees_with_migration_seed():
    """The db helper's expected result agrees with the 0023 seed rows."""
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "0023_platforms_registry.sql"
    )
    slugs = _parse_seed_slugs(migration.read_text())
    assert sorted(slugs) == ["linkedin", "x"]
