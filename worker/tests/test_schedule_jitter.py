"""Tests for staggered scheduling — Task 7: assign_scheduled_times resolver."""

from datetime import datetime, timedelta, timezone
from random import Random

import pytest

from db.campaigns import _compute_scheduled_times, assign_scheduled_times


NOW = datetime(2026, 7, 18, 12, 0, 0, tzinfo=timezone.utc)


def _variants(n, persona="p1", platform="linkedin"):
    return [
        {"id": f"v{i}", "persona_id": persona, "platform": platform}
        for i in range(n)
    ]


def test_window_spreads_variants_with_distinct_times():
    ws = datetime(2026, 8, 1, tzinfo=timezone.utc)
    we = datetime(2026, 8, 8, tzinfo=timezone.utc)
    variants = _variants(10)
    assigned = _compute_scheduled_times(
        variants,
        window_start=ws,
        window_end=we,
        slots_by_persona_platform=None,
        now=NOW,
        jitter_seconds=60,
        rng=Random(1),
    )
    times = list(assigned.values())
    # All within the window and strictly distinct.
    assert all(ws <= t <= we for t in times)
    assert len(set(times)) == len(times) == 10
    # Roughly ordered/spread — first noticeably before last.
    assert min(times) < max(times)


def test_no_window_no_slots_falls_back_to_now_plus_jitter():
    variants = _variants(5)
    assigned = _compute_scheduled_times(
        variants,
        window_start=None,
        window_end=None,
        slots_by_persona_platform=None,
        now=NOW,
        jitter_seconds=5400,
        rng=Random(2),
    )
    times = list(assigned.values())
    assert len(set(times)) == 5  # distinct
    # All at or after now, within now + jitter + small collision nudge.
    assert all(t >= NOW.replace(microsecond=0) for t in times)
    assert all(t <= NOW + timedelta(seconds=5400 + 10) for t in times)


def test_posting_slots_precedence_when_no_window():
    slot = datetime(2026, 7, 18, 15, 0, 0, tzinfo=timezone.utc)
    slots = {("p1", "linkedin"): [slot]}
    variants = _variants(3)
    assigned = _compute_scheduled_times(
        variants,
        window_start=None,
        window_end=None,
        slots_by_persona_platform=slots,
        now=NOW,
        jitter_seconds=60,
        rng=Random(3),
    )
    times = sorted(assigned.values())
    # Three variants, one slot → consume slot then roll to next day.
    assert times[0] == slot
    assert len(set(times)) == 3  # distinct even sharing one slot


def test_single_variant_window_gets_a_time():
    ws = datetime(2026, 8, 1, tzinfo=timezone.utc)
    we = datetime(2026, 8, 2, tzinfo=timezone.utc)
    assigned = _compute_scheduled_times(
        _variants(1),
        window_start=ws,
        window_end=we,
        slots_by_persona_platform=None,
        now=NOW,
        jitter_seconds=60,
        rng=Random(4),
    )
    assert len(assigned) == 1
    (t,) = assigned.values()
    assert ws <= t <= we


# ─── assign_scheduled_times integration against a fake client ─────────────────

class _Resp:
    def __init__(self, data):
        self.data = data


class _FakeClient:
    """Records post_variants updates; returns the seeded variant rows."""

    def __init__(self, variant_rows, slot_rows=None):
        self._variant_rows = variant_rows
        self._slot_rows = slot_rows or []
        self.updates: dict[str, dict] = {}

    def table(self, name):
        self._table = name
        self._update_payload = None
        return self

    def select(self, _cols):
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def in_(self, _field, _values):
        return self

    def eq(self, _field, value):
        self._eq_value = value
        return self

    async def execute(self):
        if self._table == "post_variants" and self._update_payload is not None:
            self.updates[self._eq_value] = self._update_payload
            return _Resp([])
        if self._table == "post_variants":
            return _Resp(self._variant_rows)
        if self._table == "posting_schedules":
            return _Resp(self._slot_rows)
        return _Resp([])


@pytest.mark.asyncio
async def test_assign_scheduled_times_writes_distinct_non_null_timestamps():
    rows = [
        {"id": "v0", "persona_id": "p1", "platform": "linkedin", "workspace_id": "ws-1"},
        {"id": "v1", "persona_id": "p1", "platform": "linkedin", "workspace_id": "ws-1"},
        {"id": "v2", "persona_id": "p2", "platform": "x", "workspace_id": "ws-1"},
    ]
    client = _FakeClient(rows)
    result = await assign_scheduled_times(
        client,
        ["v0", "v1", "v2"],
        window_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 8, 8, tzinfo=timezone.utc),
    )
    assert set(result) == {"v0", "v1", "v2"}
    # Every variant got a non-null scheduled_at persisted.
    assert set(client.updates) == {"v0", "v1", "v2"}
    assert all(u["scheduled_at"] for u in client.updates.values())
    assert len({u["scheduled_at"] for u in client.updates.values()}) == 3


@pytest.mark.asyncio
async def test_assign_scheduled_times_empty_is_noop():
    client = _FakeClient([])
    assert await assign_scheduled_times(client, []) == {}
