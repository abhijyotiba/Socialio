"""In-process metrics for the worker. Thread-safe counters and histograms
that accumulate in the process lifetime. Exposed via GET /system/metrics.

Design decisions:
- In-process only — no external time-series DB. Restart resets counters.
- The counters dict is module-level. FastAPI's single-threaded async event
  loop makes this safe without locks (no two coroutines mutate the same key
  concurrently in the same turn).
- Histograms are simple list-of-seconds — callers record int/float durations.
"""

from __future__ import annotations

import time
from collections import defaultdict

# ── Counters ──────────────────────────────────────────────────────────────────
# Key → int. Increment via incr(), read via snapshot().
_counters: dict[str, int] = defaultdict(int)

# ── Histograms ────────────────────────────────────────────────────────────────
# Key → list[float] (seconds). Add via observe(), read via snapshot().
_histograms: dict[str, list[float]] = defaultdict(list)


def incr(key: str, amount: int = 1) -> None:
    _counters[key] += amount


def observe(key: str, value_seconds: float) -> None:
    _histograms[key].append(value_seconds)


def snapshot() -> dict:
    """Return a JSON-safe snapshot of all accumulated metrics."""
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    counters = dict(_counters)
    histograms = {}
    for k, vals in _histograms.items():
        if not vals:
            continue
        n = len(vals)
        vals_sorted = sorted(vals)
        histograms[k] = {
            "count": n,
            "total_s": sum(vals),
            "min_s": vals_sorted[0],
            "max_s": vals_sorted[-1],
            "p50_s": vals_sorted[n // 2] if n > 0 else 0,
            "p95_s": vals_sorted[int(n * 0.95)] if n > 1 else vals_sorted[-1],
        }
    return {
        "pid": _metrics_pid(),
        "ts": now_iso,
        "counters": counters,
        "histograms": histograms,
    }


# ── Pipeline span helper ──────────────────────────────────────────────────────
class PipelineSpan:
    """Lightweight span that records latency to the metrics module on __aexit__."""

    def __init__(self, stage: str, platform: str = ""):
        self._stage = stage
        self._platform = platform
        self._start: float = 0

    async def __aenter__(self) -> PipelineSpan:
        self._start = time.monotonic()
        return self

    async def __aexit__(self, *_: object) -> None:
        elapsed = time.monotonic() - self._start
        label = f"{self._stage}" + (f".{self._platform}" if self._platform else "")
        observe(f"pipeline.{label}.s", elapsed)
        incr(f"pipeline.{label}.count")


# ── Internal ──────────────────────────────────────────────────────────────────
def _metrics_pid() -> int:
    import os

    return os.getpid()
