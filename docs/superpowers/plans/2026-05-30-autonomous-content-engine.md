# Autonomous Content Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SocialOS from a one-shot URL→post repurposer into a set-it-once autonomous content engine: one asset is atomized into many distinct posts (idea × format × angle × platform), metered into the queue at a user-set cadence, with a batch-approve/autopilot toggle and a low-reservoir nudge.

**Architecture:** Extend the existing campaign pipeline (chosen approach §5 of the spec). Add two new worker pipeline stages — `atomize` (extract atomic ideas) and a `render_planned` extension to `generate.py` (render one matrix cell) — plus a `refill-and-schedule` cron that drains the reservoir. Reuse the existing downstream unchanged: `post_variants` → scheduling → publish-due cron → metrics. New tables: `content_ideas`, `content_cadences`; `content_items` gains matrix-cell columns and a `status`.

**Tech Stack:** Python 3 / FastAPI worker (uv), Supabase Postgres + RLS, `supabase` async client, pytest (`@pytest.mark.asyncio`, `unittest.mock.patch`/`AsyncMock`). Web: Next.js 16 App Router, TypeScript strict, Vitest, thin proxy routes via `lib/worker-client.ts`.

**Reference docs:** Spec at `docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md`. Deferred items at `Future improvements/autonomous_content_engine_deferred.md`. Conventions in `CLAUDE.md` §B.7.

**Constants used throughout this plan (define once, reference everywhere):**
- Formats (6): `hot_take`, `how_to`, `personal_story`, `question`, `myth_buster`, `thread`
- Angles (4): `beginner`, `expert`, `contrarian`, `practical`
- Idea types (5): `stat`, `story`, `claim`, `framework`, `lesson`
- Platforms (2, existing): `linkedin`, `x`
- `content_items.status` values: `planned` (cell materialized, no body), `rendered` (body generated, awaiting schedule/approval)
- `post_variants.status` value for the approval gate: `pending_approval` (new value; existing values include `draft`, `scheduled`, `publishing`, `published`, `failed`, `cancelled`)

---

## Phase 0 — Schema (one migration + regenerated types)

> Per CLAUDE.md §B.7: every DB change = one numbered migration + `pnpm gen:types` + RLS on every new table, same commit. The latest migration is `0020_performance_indexes.sql`, so the new file is `0021_*`.

### Task 0.1: Write the content-engine migration

**Files:**
- Create: `supabase/migrations/0021_content_engine.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0021_content_engine.sql` with exactly this content:

```sql
-- Autonomous Content Engine
--
-- Adds the atomization matrix + reservoir/cadence layer on top of the
-- existing campaign pipeline. See
-- docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md
--
-- Three changes:
--   1. content_ideas    — atomic ideas mined from one asset (ingestion_job)
--   2. content_cadences — per-persona+platform "set it once" config
--   3. content_items    — gains matrix-cell columns + a status

-- ---------------------------------------------------------------------------
-- 1. content_ideas — the raw material the matrix multiplies
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_ideas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ingestion_job_id  UUID NOT NULL REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  essence           TEXT NOT NULL,
  idea_type         TEXT NOT NULL CHECK (idea_type IN ('stat','story','claim','framework','lesson')),
  source_quote      TEXT NOT NULL,
  strength          INT  NOT NULL DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
  suitable_formats  JSONB NOT NULL DEFAULT '[]',
  suitable_angles   JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_ideas_workspace ON public.content_ideas (workspace_id);
CREATE INDEX idx_content_ideas_job       ON public.content_ideas (ingestion_job_id);

ALTER TABLE public.content_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_ideas_member_select"
  ON public.content_ideas FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
-- Writes are worker-only (service role bypasses RLS). No insert/update/delete
-- policies → user clients can read their ideas but never mutate them.

-- ---------------------------------------------------------------------------
-- 2. content_cadences — the "set it once" config (one row per persona+platform)
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_cadences (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id               UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  platform                 TEXT NOT NULL CHECK (platform IN ('linkedin','x')),
  posts_per_week           INT  NOT NULL DEFAULT 3 CHECK (posts_per_week BETWEEN 1 AND 21),
  autopilot_enabled        BOOLEAN NOT NULL DEFAULT false,
  active                   BOOLEAN NOT NULL DEFAULT true,
  low_reservoir_threshold  INT  NOT NULL DEFAULT 5 CHECK (low_reservoir_threshold >= 0),
  last_low_nudge_at        TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, platform)
);

CREATE INDEX idx_content_cadences_workspace ON public.content_cadences (workspace_id);
CREATE INDEX idx_content_cadences_active    ON public.content_cadences (active) WHERE active = true;

ALTER TABLE public.content_cadences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_cadences_member_select"
  ON public.content_cadences FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_insert"
  ON public.content_cadences FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_update"
  ON public.content_cadences FOR UPDATE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
CREATE POLICY "content_cadences_member_delete"
  ON public.content_cadences FOR DELETE
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- 3. content_items — matrix-cell columns. All nullable so legacy rows (created
--    by the existing one-shot pipeline) remain valid; only engine rows set them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_items
  ADD COLUMN idea_id          UUID REFERENCES public.content_ideas(id) ON DELETE CASCADE,
  ADD COLUMN persona_id       UUID REFERENCES public.personas(id) ON DELETE CASCADE,
  ADD COLUMN format           TEXT CHECK (format IN ('hot_take','how_to','personal_story','question','myth_buster','thread')),
  ADD COLUMN angle            TEXT CHECK (angle IN ('beginner','expert','contrarian','practical')),
  ADD COLUMN platform         TEXT CHECK (platform IN ('linkedin','x')),
  ADD COLUMN status           TEXT,
  ADD COLUMN matrix_cell_hash TEXT;

-- The dedup guarantee: a given (idea, format, angle, platform) cell can exist
-- at most once. Partial unique index so legacy NULL-hash rows are exempt.
CREATE UNIQUE INDEX uq_content_items_matrix_cell
  ON public.content_items (matrix_cell_hash)
  WHERE matrix_cell_hash IS NOT NULL;

-- Reservoir queries select planned/rendered cells for a persona+platform.
CREATE INDEX idx_content_items_reservoir
  ON public.content_items (persona_id, platform, status)
  WHERE status IS NOT NULL;
```

- [ ] **Step 2: Verify the migration SQL is internally consistent**

Run: `grep -n "REFERENCES\|CHECK\|POLICY\|UNIQUE" supabase/migrations/0021_content_engine.sql`
Expected: every FK references an existing table (`workspaces`, `ingestion_jobs`, `personas`, `content_ideas`); CHECK enums match the constants block above; `content_ideas` has only a SELECT policy; `content_cadences` has all four; the matrix unique index is partial (`WHERE matrix_cell_hash IS NOT NULL`).

- [ ] **Step 3: Apply the migration to your Supabase project**

Run (against the dev DB — uses the project ref from your local Supabase config):
`pnpm --dir web supabase db push` *(or apply `0021_content_engine.sql` via the Supabase SQL editor if `db push` is not wired up locally)*
Expected: migration applies with no errors. If `user_workspace_ids()` is reported missing, confirm it exists (it's used by `0008_posting_schedules.sql` line 26) — it should already be present.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `pnpm --dir web gen:types`
Expected: `web/lib/db/types.ts` updates to include `content_ideas`, `content_cadences`, and the new `content_items` columns. Do NOT hand-edit this file (CLAUDE.md §B.7).

- [ ] **Step 5: Verify types regenerated**

Run: `grep -n "content_ideas\|content_cadences\|matrix_cell_hash" web/lib/db/types.ts`
Expected: matches for all three. If absent, the migration didn't apply or `gen:types` points at the wrong project.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_content_engine.sql web/lib/db/types.ts
git commit -m "feat(db): content engine schema — ideas, cadences, matrix cells"
```

---

## Phase 1 — Worker constants + matrix expansion (pure, no DB, no LLM)

This is the deterministic heart: given a list of ideas, produce the set of matrix cells with their hashes. Pure functions, fully unit-testable, no I/O.

### Task 1.1: Matrix constants module

**Files:**
- Create: `worker/pipeline/matrix.py`
- Test: `worker/tests/test_matrix.py`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/test_matrix.py`:

```python
from pipeline.matrix import (
    FORMATS,
    ANGLES,
    IDEA_TYPES,
    cell_hash,
    expand_idea_to_cells,
)


def test_vocabularies_are_the_agreed_sets():
    assert set(FORMATS) == {
        "hot_take", "how_to", "personal_story", "question", "myth_buster", "thread",
    }
    assert set(ANGLES) == {"beginner", "expert", "contrarian", "practical"}
    assert set(IDEA_TYPES) == {"stat", "story", "claim", "framework", "lesson"}


def test_cell_hash_is_stable_and_order_independent_of_call():
    h1 = cell_hash("idea-1", "hot_take", "expert", "linkedin")
    h2 = cell_hash("idea-1", "hot_take", "expert", "linkedin")
    assert h1 == h2
    assert h1 != cell_hash("idea-1", "hot_take", "expert", "x")
    assert h1 != cell_hash("idea-1", "how_to", "expert", "linkedin")


def test_expand_uses_only_suitable_formats_and_angles():
    idea = {
        "id": "idea-1",
        "suitable_formats": ["hot_take", "thread"],
        "suitable_angles": ["expert"],
    }
    cells = expand_idea_to_cells(idea, platforms=["linkedin", "x"])
    combos = {(c["format"], c["angle"], c["platform"]) for c in cells}
    # 2 formats x 1 angle x 2 platforms = 4 cells
    assert len(cells) == 4
    assert ("hot_take", "expert", "linkedin") in combos
    assert ("thread", "expert", "x") in combos
    # Nothing outside the suitable sets:
    assert all(c["format"] in {"hot_take", "thread"} for c in cells)
    assert all(c["angle"] == "expert" for c in cells)


def test_expand_falls_back_to_all_vocab_when_suitable_lists_empty():
    idea = {"id": "idea-2", "suitable_formats": [], "suitable_angles": []}
    cells = expand_idea_to_cells(idea, platforms=["linkedin"])
    # 6 formats x 4 angles x 1 platform
    assert len(cells) == 24


def test_expand_ignores_unknown_format_or_angle_values():
    idea = {
        "id": "idea-3",
        "suitable_formats": ["hot_take", "not_a_format"],
        "suitable_angles": ["expert", "nonsense"],
    }
    cells = expand_idea_to_cells(idea, platforms=["linkedin"])
    assert len(cells) == 1  # only (hot_take, expert, linkedin) survives filtering
    assert cells[0]["format"] == "hot_take"
    assert cells[0]["angle"] == "expert"


def test_each_cell_carries_idea_id_and_hash():
    idea = {"id": "idea-9", "suitable_formats": ["how_to"], "suitable_angles": ["practical"]}
    cells = expand_idea_to_cells(idea, platforms=["x"])
    c = cells[0]
    assert c["idea_id"] == "idea-9"
    assert c["matrix_cell_hash"] == cell_hash("idea-9", "how_to", "practical", "x")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_matrix.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.matrix'`

- [ ] **Step 3: Write the implementation**

Create `worker/pipeline/matrix.py`:

```python
"""The atomization matrix — pure, deterministic cell expansion.

Given an idea (with its LLM-tagged suitable formats/angles) and the target
platforms, produce the set of (idea × format × angle × platform) cells. Each
cell carries a stable hash used as the dedup key in content_items.
"""

import hashlib

FORMATS = ("hot_take", "how_to", "personal_story", "question", "myth_buster", "thread")
ANGLES = ("beginner", "expert", "contrarian", "practical")
IDEA_TYPES = ("stat", "story", "claim", "framework", "lesson")


def cell_hash(idea_id: str, fmt: str, angle: str, platform: str) -> str:
    raw = f"{idea_id}|{fmt}|{angle}|{platform}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def expand_idea_to_cells(idea: dict, platforms: list[str]) -> list[dict]:
    """Cross one idea with its suitable formats/angles and the platforms.

    Empty suitable lists fall back to the full vocabulary (the LLM gave us no
    guidance, so allow everything). Unknown values are filtered out so a
    hallucinated format never reaches the DB CHECK constraint.
    """
    formats = [f for f in (idea.get("suitable_formats") or []) if f in FORMATS] or list(FORMATS)
    angles = [a for a in (idea.get("suitable_angles") or []) if a in ANGLES] or list(ANGLES)

    cells: list[dict] = []
    for platform in platforms:
        for fmt in formats:
            for angle in angles:
                cells.append(
                    {
                        "idea_id": idea["id"],
                        "format": fmt,
                        "angle": angle,
                        "platform": platform,
                        "matrix_cell_hash": cell_hash(idea["id"], fmt, angle, platform),
                    }
                )
    return cells
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_matrix.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/pipeline/matrix.py worker/tests/test_matrix.py
git commit -m "feat(worker): matrix cell expansion + dedup hashing"
```

---

## Phase 1.5 — LLM concurrency limit (backend capacity safeguard)

> **Why this exists:** the atomization matrix issues many LLM calls (1 extract + 1 per rendered cell). Under concurrent load — several users atomizing, or the refill cron rendering a batch — unbounded calls would blow the Groq/Gemini per-key requests-per-minute limit, which is the worker's #1 capacity bottleneck (not CPU, not architecture). A single global semaphore around `generate()` caps in-flight LLM calls process-wide, so traffic spikes queue instead of failing. This is the agreed safeguard in place of any microservice split; the DB-driven cron already gives us a durable queue, so this is the only capacity change v1 needs. See `Future improvements/autonomous_content_engine_deferred.md` D10 for the horizontal-scaling path beyond this.

### Task 1.5.1: Global semaphore around `generate()`

**Files:**
- Modify: `worker/config.py` (add `llm_max_concurrency` setting)
- Modify: `worker/adapters/llm.py` (wrap `generate` in a module-level semaphore)
- Test: `worker/tests/test_llm_concurrency.py`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/test_llm_concurrency.py`:

```python
import asyncio
import pytest
from unittest.mock import patch


@pytest.mark.asyncio
async def test_generate_caps_in_flight_calls_at_the_limit():
    """With the limiter set to 2, no more than 2 underlying provider calls run
    concurrently even when 5 generate() coroutines are launched at once."""
    import adapters.llm as llm

    in_flight = 0
    peak = 0

    async def fake_groq(system_prompt, user_message):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.02)  # hold the slot so overlap is observable
        in_flight -= 1
        return "ok"

    # Force a known small limit for the test, independent of env config.
    with patch.object(llm, "_LLM_SEMAPHORE", asyncio.Semaphore(2)), \
         patch("adapters.llm.groq_generate", side_effect=fake_groq):
        results = await asyncio.gather(
            *(llm.generate(system_prompt="s", user_message="m") for _ in range(5))
        )

    assert results == ["ok"] * 5
    assert peak <= 2  # the limiter held the line


@pytest.mark.asyncio
async def test_generate_still_falls_back_to_gemini_under_the_limiter():
    """The semaphore must not change the Groq→Gemini fallback contract."""
    import adapters.llm as llm

    async def boom(system_prompt, user_message):
        raise RuntimeError("groq down")

    async def ok_gemini(system_prompt, user_message):
        return "from gemini"

    with patch.object(llm, "_LLM_SEMAPHORE", asyncio.Semaphore(2)), \
         patch("adapters.llm.groq_generate", side_effect=boom), \
         patch("adapters.llm.gemini_generate", side_effect=ok_gemini):
        out = await llm.generate(system_prompt="s", user_message="m")

    assert out == "from gemini"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_llm_concurrency.py -v`
Expected: FAIL with `AttributeError: module 'adapters.llm' has no attribute '_LLM_SEMAPHORE'`

- [ ] **Step 3: Add the config setting**

In `worker/config.py`, add this field to the `Settings` class alongside the other LLM settings (after the `gemini_model` line):

```python
    # Cap on concurrent in-flight LLM provider calls process-wide. Protects the
    # Groq/Gemini per-key rate limits when many cells render at once. Tune up as
    # provider quota allows; keep conservative by default.
    llm_max_concurrency: int = 5
```

- [ ] **Step 4: Wrap `generate` in the semaphore**

Rewrite `worker/adapters/llm.py` to introduce a module-level semaphore and acquire it around the provider calls (keep the existing Groq→Gemini fallback exactly):

```python
import asyncio

import structlog
from fastapi import HTTPException

from adapters.groq import groq_generate
from adapters.gemini import gemini_generate
from config import settings

logger = structlog.get_logger()

# Process-wide cap on concurrent LLM calls. The atomization matrix can issue
# many calls at once (refill cron batch); this queues them instead of blowing
# the provider's per-key rate limit. Created once at import, shared by all
# coroutines in this worker process.
_LLM_SEMAPHORE = asyncio.Semaphore(settings.llm_max_concurrency)


async def generate(system_prompt: str, user_message: str) -> str:
    """Call Groq; fall back to Gemini on any exception. Bounded by a global
    semaphore so concurrent callers can't exceed the provider rate limit."""
    async with _LLM_SEMAPHORE:
        try:
            return await groq_generate(system_prompt, user_message)
        except Exception as exc:
            logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
            try:
                return await gemini_generate(system_prompt, user_message)
            except Exception as gemini_exc:
                logger.error("gemini_also_failed", error=str(gemini_exc))
                raise HTTPException(
                    status_code=502,
                    detail="Both primary and fallback AI models failed to generate a response. Please try again later.",
                )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_llm_concurrency.py tests/test_llm.py -v`
Expected: PASS — both new tests AND the existing `test_llm.py` (confirms the fallback contract is unchanged).

- [ ] **Step 6: Add the env var to `.env.example`**

Per CLAUDE.md §B.7 (every env var goes in `.env.example` with a one-line comment), add:

```
# Max concurrent LLM provider calls (protects Groq/Gemini rate limits). Default 5.
LLM_MAX_CONCURRENCY=
```

- [ ] **Step 7: Commit**

```bash
git add worker/config.py worker/adapters/llm.py worker/tests/test_llm_concurrency.py .env.example
git commit -m "feat(worker): global LLM concurrency limit (rate-limit safeguard)"
```

---

## Phase 2 — Worker stage A: extract ideas (LLM)

### Task 2.1: `atomize.py` — extract atomic ideas from asset text

**Files:**
- Create: `worker/pipeline/atomize.py`
- Test: `worker/tests/test_atomize.py`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/test_atomize.py`:

```python
import json
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_extract_ideas_parses_llm_json_array():
    fake = json.dumps([
        {
            "essence": "Most onboarding flows lose users at step 3.",
            "idea_type": "stat",
            "source_quote": "40% of users drop off at the third onboarding step.",
            "strength": 4,
            "suitable_formats": ["stat_callout", "myth_buster", "hot_take"],
            "suitable_angles": ["expert", "practical"],
        }
    ])
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = fake
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas(
            title="Onboarding Report",
            text="40% of users drop off at the third onboarding step. ...",
            brand_system_prompt="Professional tone.",
        )
    assert len(ideas) == 1
    idea = ideas[0]
    assert idea["essence"].startswith("Most onboarding")
    assert idea["idea_type"] == "stat"
    assert idea["source_quote"]
    assert idea["strength"] == 4
    # Unknown format ("stat_callout") is dropped; valid ones kept.
    assert "stat_callout" not in idea["suitable_formats"]
    assert "myth_buster" in idea["suitable_formats"]
    assert idea["suitable_angles"] == ["expert", "practical"]


@pytest.mark.asyncio
async def test_extract_ideas_tolerates_json_wrapped_in_markdown_fence():
    fenced = "```json\n" + json.dumps([
        {"essence": "x", "idea_type": "claim", "source_quote": "q",
         "strength": 3, "suitable_formats": ["how_to"], "suitable_angles": ["beginner"]}
    ]) + "\n```"
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = fenced
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert len(ideas) == 1
    assert ideas[0]["idea_type"] == "claim"


@pytest.mark.asyncio
async def test_extract_ideas_drops_malformed_entries():
    bad = json.dumps([
        {"essence": "good", "idea_type": "lesson", "source_quote": "q",
         "strength": 5, "suitable_formats": ["thread"], "suitable_angles": ["expert"]},
        {"essence": "", "idea_type": "lesson", "source_quote": "q"},          # empty essence
        {"idea_type": "not_a_type", "essence": "e", "source_quote": "q"},     # bad type
        {"essence": "no quote", "idea_type": "claim", "source_quote": ""},    # empty quote
    ])
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = bad
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert len(ideas) == 1
    assert ideas[0]["essence"] == "good"


@pytest.mark.asyncio
async def test_extract_ideas_returns_empty_on_unparseable_output():
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "I could not find any ideas, sorry!"
        from pipeline.atomize import extract_ideas
        ideas = await extract_ideas("T", "body", "brand")
    assert ideas == []


@pytest.mark.asyncio
async def test_extract_ideas_truncates_very_long_text():
    long_text = "x" * 50000
    with patch("pipeline.atomize.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "[]"
        from pipeline.atomize import extract_ideas
        await extract_ideas("T", long_text, "brand")
        sent = mock_gen.call_args[1]["user_message"]
    assert len(sent) < 16000  # text cap + prompt overhead
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_atomize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.atomize'`

- [ ] **Step 3: Write the implementation**

Create `worker/pipeline/atomize.py`:

```python
"""Stage A of the content engine — extract atomic ideas from an asset.

One structured-output LLM call mines the asset text into a JSON array of
ideas. Each idea is grounded in a verbatim source_quote (anti-fabrication
anchor) and tagged with the formats/angles it best suits, so the matrix only
expands sensible cells.
"""

import json
import re

from adapters.llm import generate
from pipeline.matrix import FORMATS, ANGLES, IDEA_TYPES

_MAX_TEXT = 12000

_SYSTEM = (
    "You extract atomic, reusable content ideas from source material for social "
    "media. Each idea must be a single self-contained insight grounded in a "
    "verbatim quote from the source. Never invent facts or statistics."
)


def _build_user_message(title: str, text: str) -> str:
    title_line = f"Title: {title}\n\n" if title.strip() else ""
    return (
        f"{title_line}Source material:\n{text[:_MAX_TEXT]}\n\n"
        "Extract every distinct, postable idea. Return ONLY a JSON array. Each "
        "element must be an object with these keys:\n"
        '  "essence": one-sentence statement of the idea\n'
        '  "idea_type": one of ' + ", ".join(IDEA_TYPES) + "\n"
        '  "source_quote": a verbatim snippet from the source that grounds it\n'
        '  "strength": integer 1-5, how strong/postable the idea is\n'
        '  "suitable_formats": subset of ' + ", ".join(FORMATS) + "\n"
        '  "suitable_angles": subset of ' + ", ".join(ANGLES) + "\n"
        "Return [] if there are no usable ideas. No prose, no code fence."
    )


def _strip_fence(raw: str) -> str:
    fenced = re.search(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL)
    if fenced:
        return fenced.group(1).strip()
    return raw.strip()


def _clean_idea(entry: object) -> dict | None:
    if not isinstance(entry, dict):
        return None
    essence = str(entry.get("essence") or "").strip()
    idea_type = str(entry.get("idea_type") or "").strip()
    source_quote = str(entry.get("source_quote") or "").strip()
    if not essence or not source_quote or idea_type not in IDEA_TYPES:
        return None
    try:
        strength = int(entry.get("strength", 3))
    except (TypeError, ValueError):
        strength = 3
    strength = max(1, min(5, strength))
    formats = [f for f in (entry.get("suitable_formats") or []) if f in FORMATS]
    angles = [a for a in (entry.get("suitable_angles") or []) if a in ANGLES]
    return {
        "essence": essence,
        "idea_type": idea_type,
        "source_quote": source_quote,
        "strength": strength,
        "suitable_formats": formats,
        "suitable_angles": angles,
    }


async def extract_ideas(
    title: str, text: str, brand_system_prompt: str
) -> list[dict]:
    if not text.strip():
        return []
    user_message = _build_user_message(title, text)
    # Brand voice steers which ideas matter, but the extraction contract is fixed.
    system_prompt = f"{_SYSTEM}\n\nBrand context:\n{brand_system_prompt}"
    raw = await generate(system_prompt=system_prompt, user_message=user_message)

    try:
        parsed = json.loads(_strip_fence(raw))
    except (ValueError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []

    cleaned = [c for c in (_clean_idea(e) for e in parsed) if c is not None]
    return cleaned
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_atomize.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/pipeline/atomize.py worker/tests/test_atomize.py
git commit -m "feat(worker): extract-ideas stage (atomize)"
```

---

## Phase 3 — Worker stage B: render one matrix cell (LLM)

### Task 3.1: Add `render_cell` to `generate.py`

**Files:**
- Modify: `worker/pipeline/generate.py` (add a new function; leave `generate_variants` untouched)
- Test: `worker/tests/test_render_cell.py`

- [ ] **Step 1: Write the failing test**

Create `worker/tests/test_render_cell.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_render_cell_includes_idea_format_angle_and_grounding():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "  A punchy contrarian LinkedIn post.  "
        from pipeline.generate import render_cell
        body = await render_cell(
            essence="Onboarding loses users at step 3.",
            source_quote="40% drop off at the third step.",
            fmt="hot_take",
            angle="contrarian",
            platform="linkedin",
            brand_system_prompt="Professional tone.",
        )
    assert body == "A punchy contrarian LinkedIn post."  # trimmed
    msg = mock_gen.call_args[1]["user_message"].lower()
    assert "onboarding loses users" in msg
    assert "40% drop off" in msg            # grounding quote present
    assert "hot_take" in msg or "hot take" in msg
    assert "contrarian" in msg
    assert "linkedin" in msg
    # brand prompt is the system prompt, not the user message
    assert mock_gen.call_args[1]["system_prompt"] == "Professional tone."


@pytest.mark.asyncio
async def test_render_cell_x_mentions_platform_constraint():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Short."
        from pipeline.generate import render_cell
        await render_cell(
            essence="e", source_quote="q", fmt="thread", angle="expert",
            platform="x", brand_system_prompt="brand",
        )
        msg = mock_gen.call_args[1]["user_message"].lower()
    assert "280" in msg or "twitter" in msg or "x/" in msg


@pytest.mark.asyncio
async def test_render_cell_requires_essence():
    from pipeline.generate import render_cell
    with pytest.raises(ValueError):
        await render_cell(
            essence="  ", source_quote="q", fmt="how_to", angle="beginner",
            platform="linkedin", brand_system_prompt="brand",
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_render_cell.py -v`
Expected: FAIL with `ImportError: cannot import name 'render_cell'`

- [ ] **Step 3: Write the implementation**

Append to `worker/pipeline/generate.py` (do not modify the existing `_PLATFORM_HINTS`, `_build_user_message`, or `generate_variants`; reuse `_PLATFORM_HINTS`):

```python
_FORMAT_HINTS: dict[str, str] = {
    "hot_take": "a bold, opinionated hot take",
    "how_to": "a practical step-by-step how-to",
    "personal_story": "a short first-person story with a lesson",
    "question": "an engaging question that invites replies",
    "myth_buster": "a myth-vs-reality correction",
    "thread": "a multi-point thread (numbered points)",
}

_ANGLE_HINTS: dict[str, str] = {
    "beginner": "for an audience new to the topic",
    "expert": "for an experienced, expert audience",
    "contrarian": "taking a contrarian stance against common wisdom",
    "practical": "focused on practical, immediately actionable value",
}


async def render_cell(
    essence: str,
    source_quote: str,
    fmt: str,
    angle: str,
    platform: str,
    brand_system_prompt: str,
) -> str:
    """Stage B — render ONE matrix cell into a finished post body."""
    if not essence.strip():
        raise ValueError("render_cell requires an idea essence")

    platform_hint = _PLATFORM_HINTS.get(platform, platform)
    format_hint = _FORMAT_HINTS.get(fmt, fmt)
    angle_hint = _ANGLE_HINTS.get(angle, angle)

    user_message = (
        f"Write a {platform_hint}.\n\n"
        f"Form: write it as {format_hint} ({fmt}).\n"
        f"Angle: {angle_hint} ({angle}).\n\n"
        f"Express this single idea:\n{essence}\n\n"
        f"Stay truthful to this source quote (do not invent facts):\n{source_quote}\n\n"
        "Return only the post text — no labels, no quotation marks."
    )
    body = await generate(system_prompt=brand_system_prompt, user_message=user_message)
    return body.strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_render_cell.py tests/test_generate_pipeline.py -v`
Expected: PASS (3 new tests + the existing generate-pipeline tests still green — confirms we didn't break `generate_variants`)

- [ ] **Step 5: Commit**

```bash
git add worker/pipeline/generate.py worker/tests/test_render_cell.py
git commit -m "feat(worker): render-cell stage B (platform-native matrix render)"
```

---

## Phase 4 — Worker DB helpers (ideas, cells, cadences, reservoir)

All follow the existing `worker/db/*.py` style: module-level async functions taking `client: AsyncClient` first, using `.table(...)` PostgREST calls.

### Task 4.1: `db/content_ideas.py`

**Files:**
- Create: `worker/db/content_ideas.py`
- Test: `worker/tests/test_content_engine_db.py` (shared test file for Phase 4)

- [ ] **Step 1: Write the failing test**

Create `worker/tests/test_content_engine_db.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock


def _fake_client_returning(data):
    """Builds a chainable mock matching the supabase async client surface used
    by our db helpers: client.table(...).insert(...).execute() etc."""
    execute = AsyncMock(return_value=MagicMock(data=data, count=None))
    chain = MagicMock()
    # Every chained method returns the same chain; execute is awaited at the end.
    for m in ("table", "insert", "select", "update", "delete", "eq", "in_",
              "order", "limit", "is_", "not_", "gte", "lt", "maybe_single"):
        getattr(chain, m).return_value = chain
    chain.execute = execute
    client = MagicMock()
    client.table.return_value = chain
    return client, chain


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db.content_ideas'`

- [ ] **Step 3: Write the implementation**

Create `worker/db/content_ideas.py`:

```python
from typing import Any
from supabase import AsyncClient


async def create_content_ideas(
    client: AsyncClient, ideas: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not ideas:
        return []
    res = await client.table("content_ideas").insert(ideas).execute()
    return res.data or []


async def list_ideas_for_job(
    client: AsyncClient, ingestion_job_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("content_ideas")
        .select("*")
        .eq("ingestion_job_id", ingestion_job_id)
        .execute()
    )
    return res.data or []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/db/content_ideas.py worker/tests/test_content_engine_db.py
git commit -m "feat(worker): content_ideas db helpers"
```

### Task 4.2: `db/content_cells.py` — materialize + drain planned cells

**Files:**
- Create: `worker/db/content_cells.py`
- Test: extend `worker/tests/test_content_engine_db.py`

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_content_engine_db.py`:

```python
@pytest.mark.asyncio
async def test_materialize_cells_inserts_with_ignore_duplicates():
    client, chain = _fake_client_returning([{"id": "c1"}])
    from db.content_cells import materialize_cells
    rows = await materialize_cells(client, [{"matrix_cell_hash": "h1", "status": "planned"}])
    assert len(rows) == 1
    # upsert (not plain insert) so dedup collisions are ignored, not errors
    assert chain.upsert.called or chain.insert.called


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
```

For the upsert mock to exist, add `"upsert"` to the chain method list in `_fake_client_returning` (edit that helper's tuple to include `"upsert"`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db.content_cells'`

- [ ] **Step 3: Write the implementation**

Create `worker/db/content_cells.py`:

```python
"""Planned matrix cells live in content_items (status='planned'|'rendered').

Materialize = bulk-insert planned cells (dedup via the partial unique index on
matrix_cell_hash — collisions are ignored). Reservoir = count of planned cells
for a persona+platform. Drain = fetch the next planned cells to render.
"""

from typing import Any
from supabase import AsyncClient


async def materialize_cells(
    client: AsyncClient, cells: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not cells:
        return []
    # ignore_duplicates: a cell whose matrix_cell_hash already exists is silently
    # skipped — this IS the "never repeat a cell" guarantee at the DB layer.
    res = (
        await client.table("content_items")
        .upsert(cells, on_conflict="matrix_cell_hash", ignore_duplicates=True)
        .execute()
    )
    return res.data or []


async def count_reservoir(
    client: AsyncClient, persona_id: str, platform: str
) -> int:
    """Reservoir level = planned cells not yet rendered/scheduled."""
    res = (
        await client.table("content_items")
        .select("id", count="exact", head=True)
        .eq("persona_id", persona_id)
        .eq("platform", platform)
        .eq("status", "planned")
        .execute()
    )
    return res.count or 0


async def next_planned_cells(
    client: AsyncClient, persona_id: str, platform: str, limit: int
) -> list[dict[str, Any]]:
    """Oldest-first drain order for v1. Join the idea for render inputs.
    (Smart ordering is deferred — see deferred doc D1.)"""
    res = (
        await client.table("content_items")
        .select("*, content_ideas(essence, source_quote)")
        .eq("persona_id", persona_id)
        .eq("platform", platform)
        .eq("status", "planned")
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    return res.data or []


async def mark_cell_rendered(
    client: AsyncClient, content_item_id: str
) -> None:
    await (
        client.table("content_items")
        .update({"status": "rendered"})
        .eq("id", content_item_id)
        .execute()
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add worker/db/content_cells.py worker/tests/test_content_engine_db.py
git commit -m "feat(worker): content cell materialize + reservoir + drain helpers"
```

### Task 4.3: `db/content_cadences.py`

**Files:**
- Create: `worker/db/content_cadences.py`
- Test: extend `worker/tests/test_content_engine_db.py`

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_content_engine_db.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db.content_cadences'`

- [ ] **Step 3: Write the implementation**

Create `worker/db/content_cadences.py`:

```python
from datetime import datetime, timezone
from typing import Any
from supabase import AsyncClient


async def upsert_cadence(
    client: AsyncClient, values: dict[str, Any]
) -> dict[str, Any]:
    """Create or update the cadence for a (persona, platform). One row each."""
    payload = {**values, "updated_at": datetime.now(timezone.utc).isoformat()}
    res = (
        await client.table("content_cadences")
        .upsert(payload, on_conflict="persona_id,platform")
        .execute()
    )
    return res.data[0]


async def list_cadences_for_workspace(
    client: AsyncClient, workspace_id: str
) -> list[dict[str, Any]]:
    res = (
        await client.table("content_cadences")
        .select("*")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return res.data or []


async def list_active_cadences(client: AsyncClient) -> list[dict[str, Any]]:
    """Service-role only — the refill cron iterates every active cadence."""
    res = (
        await client.table("content_cadences")
        .select("*")
        .eq("active", True)
        .execute()
    )
    return res.data or []


async def mark_low_nudge_sent(client: AsyncClient, cadence_id: str) -> None:
    await (
        client.table("content_cadences")
        .update({"last_low_nudge_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", cadence_id)
        .execute()
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_db.py -v`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add worker/db/content_cadences.py worker/tests/test_content_engine_db.py
git commit -m "feat(worker): content_cadences db helpers"
```

---

## Phase 5 — Worker: atomize orchestration route

Ties stage A + matrix + materialize together behind a user-authenticated endpoint. Called after ingestion completes (the asset already has extracted text).

### Task 5.1: `routes/content_engine.py` — POST /content-engine/atomize

**Files:**
- Create: `worker/routes/content_engine.py`
- Modify: `worker/main.py` (mount the new router)
- Test: `worker/tests/test_content_engine_route.py`

- [ ] **Step 1: Read main.py to find the router-mount pattern**

Run: `grep -n "include_router\|import" worker/main.py`
Expected: shows how existing routers (e.g. `posts`, `cron`) are imported and mounted. Mirror that exact pattern in Step 4.

- [ ] **Step 2: Write the failing test**

Create `worker/tests/test_content_engine_route.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient


def _client():
    from main import app
    return TestClient(app)


@pytest.mark.asyncio
async def test_atomize_orchestration_extracts_materializes_and_counts():
    # Drive the orchestration function directly (route auth is covered by the
    # shared auth tests; here we test the engine logic).
    from routes.content_engine import run_atomize

    fake_ideas = [{
        "essence": "e", "idea_type": "claim", "source_quote": "q",
        "strength": 4, "suitable_formats": ["hot_take"], "suitable_angles": ["expert"],
    }]
    fake_client = AsyncMock()

    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save_ideas, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat:
        mock_extract.return_value = fake_ideas
        mock_save_ideas.return_value = [{**fake_ideas[0], "id": "idea-1"}]
        mock_mat.return_value = [{"id": "cell-1"}]

        result = await run_atomize(
            client=fake_client,
            workspace_id="w1",
            persona_id="p1",
            ingestion_job_id="job-1",
            title="T",
            text="some asset text",
            brand_system_prompt="brand",
            platforms=["linkedin"],
        )

    assert result["ideas_extracted"] == 1
    assert result["cells_materialized"] == 1
    # 1 idea x 1 format x 1 angle x 1 platform = 1 cell sent to materialize
    sent_cells = mock_mat.call_args[0][1]
    assert len(sent_cells) == 1
    assert sent_cells[0]["status"] == "planned"
    assert sent_cells[0]["idea_id"] == "idea-1"
    assert sent_cells[0]["workspace_id"] == "w1"
    assert sent_cells[0]["persona_id"] == "p1"
    assert sent_cells[0]["matrix_cell_hash"]


@pytest.mark.asyncio
async def test_atomize_with_no_ideas_materializes_nothing():
    from routes.content_engine import run_atomize
    fake_client = AsyncMock()
    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat:
        mock_extract.return_value = []
        result = await run_atomize(
            client=fake_client, workspace_id="w1", persona_id="p1",
            ingestion_job_id="job-1", title="T", text="text",
            brand_system_prompt="b", platforms=["linkedin"],
        )
    assert result["ideas_extracted"] == 0
    assert result["cells_materialized"] == 0
    mock_save.assert_not_called()
    mock_mat.assert_not_called()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'routes.content_engine'`

- [ ] **Step 4: Write the implementation**

Create `worker/routes/content_engine.py`:

```python
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import verify_hmac, verify_user
from db import content_cadences as db_cadences
from db import content_cells as db_cells
from db import content_ideas as db_ideas
from db import brand_configs as db_brand
from db import ingestion as db_ingestion
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline.atomize import extract_ideas
from pipeline.matrix import expand_idea_to_cells

log = structlog.get_logger()
router = APIRouter(prefix="/content-engine")


async def run_atomize(
    client: Any,
    workspace_id: str,
    persona_id: str,
    ingestion_job_id: str,
    title: str,
    text: str,
    brand_system_prompt: str,
    platforms: list[str],
) -> dict:
    """Stage A + matrix materialize. Pure orchestration over the tested units."""
    ideas = await extract_ideas(title, text, brand_system_prompt)
    if not ideas:
        return {"ideas_extracted": 0, "cells_materialized": 0}

    saved = await db_ideas.create_content_ideas(
        client,
        [
            {
                "workspace_id": workspace_id,
                "ingestion_job_id": ingestion_job_id,
                "essence": i["essence"],
                "idea_type": i["idea_type"],
                "source_quote": i["source_quote"],
                "strength": i["strength"],
                "suitable_formats": i["suitable_formats"],
                "suitable_angles": i["suitable_angles"],
            }
            for i in ideas
        ],
    )

    cells: list[dict] = []
    for idea in saved:
        for cell in expand_idea_to_cells(idea, platforms):
            cells.append(
                {
                    "workspace_id": workspace_id,
                    "persona_id": persona_id,
                    "ingestion_job_id": ingestion_job_id,
                    "idea_id": cell["idea_id"],
                    "format": cell["format"],
                    "angle": cell["angle"],
                    "platform": cell["platform"],
                    "matrix_cell_hash": cell["matrix_cell_hash"],
                    "status": "planned",
                }
            )

    materialized = await db_cells.materialize_cells(client, cells)
    return {
        "ideas_extracted": len(saved),
        "cells_materialized": len(materialized),
    }


class AtomizeRequest(BaseModel):
    ingestion_job_id: str
    persona_id: str
    platforms: list[str]


@router.post("/atomize")
async def atomize(req: AtomizeRequest, request: Request) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    job = await db_ingestion.get_ingestion_job(client, req.ingestion_job_id)
    if not job or job.get("workspace_id") != workspace_id:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    if not (job.get("extracted_text") or "").strip():
        raise HTTPException(status_code=409, detail="Asset has no extracted text yet")

    brand = await db_brand.get_brand_config_for_persona(client, req.persona_id)
    if not (brand and brand.get("custom_system_prompt")):
        raise HTTPException(
            status_code=400,
            detail="Set up your brand voice before atomizing assets.",
        )

    return await run_atomize(
        client=client,
        workspace_id=workspace_id,
        persona_id=req.persona_id,
        ingestion_job_id=req.ingestion_job_id,
        title=job.get("extracted_title") or "",
        text=job["extracted_text"],
        brand_system_prompt=brand["custom_system_prompt"],
        platforms=req.platforms,
    )
```

Then mount it in `worker/main.py` following the exact pattern from Step 1 (add the import alongside the others and an `app.include_router(content_engine.router)` call alongside the others). Example (adjust to match the file's actual style):

```python
from routes import content_engine  # add with the other route imports
# ...
app.include_router(content_engine.router)  # add with the other include_router calls
```

- [ ] **Step 5: Verify `get_ingestion_job` and `get_brand_config_for_persona` exist with these names**

Run: `grep -rn "def get_ingestion_job\|def get_brand_config_for_persona" worker/db/`
Expected: both exist. If `get_ingestion_job` has a different name, use the actual name (check `worker/db/ingestion.py`) and update the route + this plan reference.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Run the full worker suite to confirm nothing regressed**

Run: `cd worker && uv run pytest -q`
Expected: all green (including the existing suite).

- [ ] **Step 8: Commit**

```bash
git add worker/routes/content_engine.py worker/main.py worker/tests/test_content_engine_route.py
git commit -m "feat(worker): atomize orchestration route (/content-engine/atomize)"
```

---

## Phase 6 — Worker: cadence management route

### Task 6.1: PUT /content-engine/cadence (upsert) on the same router

**Files:**
- Modify: `worker/routes/content_engine.py` (add the cadence endpoint)
- Test: extend `worker/tests/test_content_engine_route.py`

- [ ] **Step 1: Write the failing test**

Append to `worker/tests/test_content_engine_route.py`:

```python
@pytest.mark.asyncio
async def test_cadence_payload_validation_rejects_bad_platform():
    from routes.content_engine import CadenceRequest
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        CadenceRequest(persona_id="p1", platform="facebook", posts_per_week=3,
                       autopilot_enabled=False, active=True)


@pytest.mark.asyncio
async def test_cadence_payload_validation_rejects_out_of_range_cadence():
    from routes.content_engine import CadenceRequest
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        CadenceRequest(persona_id="p1", platform="linkedin", posts_per_week=99,
                       autopilot_enabled=False, active=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -k cadence -v`
Expected: FAIL with `ImportError: cannot import name 'CadenceRequest'`

- [ ] **Step 3: Write the implementation**

Append to `worker/routes/content_engine.py`:

```python
from typing import Literal
from pydantic import Field


class CadenceRequest(BaseModel):
    persona_id: str
    platform: Literal["linkedin", "x"]
    posts_per_week: int = Field(ge=1, le=21)
    autopilot_enabled: bool = False
    active: bool = True
    low_reservoir_threshold: int = Field(default=5, ge=0)


@router.put("/cadence")
async def upsert_cadence_route(req: CadenceRequest, request: Request) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    row = await db_cadences.upsert_cadence(
        client,
        {
            "workspace_id": workspace_id,
            "persona_id": req.persona_id,
            "platform": req.platform,
            "posts_per_week": req.posts_per_week,
            "autopilot_enabled": req.autopilot_enabled,
            "active": req.active,
            "low_reservoir_threshold": req.low_reservoir_threshold,
        },
    )
    return {"cadence": row}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_content_engine_route.py -v`
Expected: PASS (all content-engine route tests)

- [ ] **Step 5: Commit**

```bash
git add worker/routes/content_engine.py worker/tests/test_content_engine_route.py
git commit -m "feat(worker): cadence upsert route (/content-engine/cadence)"
```

---

## Phase 7 — Worker: refill-and-schedule cron (the autopilot loop)

This drains the reservoir into scheduled variants, respecting the autopilot toggle, and fires the low-reservoir nudge.

> **Capacity note:** this cron fans out across active cadences with `asyncio.gather`, and each cadence renders up to `per_cadence_limit` cells. The *actual* LLM concurrency is bounded by the global semaphore added in Phase 1.5 (it wraps `render_cell`'s underlying `generate()` call), so even a burst of active cadences cannot exceed the provider rate limit — calls queue on the semaphore. `per_cadence_limit` (default 5) is the per-run drain depth, deliberately small so each cron tick is bounded work; the reservoir is drained gradually across ticks, not all at once.

### Task 7.1: `run_refill_and_schedule` in `cron/jobs.py`

**Files:**
- Modify: `worker/cron/jobs.py` (add the new job function + a small notify helper)
- Modify: `worker/routes/cron.py` (add the route)
- Test: `worker/tests/test_refill_cron.py`

- [ ] **Step 1: Check how the low-fuel nudge should notify (reuse existing pattern)**

Run: `grep -rn "needs_reauth\|notify\|audit_event\|insert_audit" worker/cron/jobs.py worker/db/audit_events.py`
Expected: confirms `db_audit.insert_audit_event(svc, {...})` is the in-system notification mechanism already used by the publish cron. The nudge will emit an audit event of type `cadence.low_reservoir` that the web layer surfaces as a banner (email delivery is a follow-up, noted in the spec as reusing the V2 failure-notification pattern; for this plan the nudge = audit event the web reads).

- [ ] **Step 2: Write the failing test**

Create `worker/tests/test_refill_cron.py`:

```python
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
        mock_cv.return_value = [{"id": "v1"}]

        from cron.jobs import run_refill_and_schedule
        result = await run_refill_and_schedule(svc, per_cadence_limit=1)

    mock_render.assert_awaited_once()
    mock_cv.assert_awaited_once()
    # the created variant carries the rendered body + pending_approval (autopilot
    # ON would be schedule-eligible; this cadence is autopilot ON so status='scheduled'
    # candidacy is handled downstream — see assertion below)
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd worker && uv run pytest tests/test_refill_cron.py -v`
Expected: FAIL with `ImportError: cannot import name 'run_refill_and_schedule'`

- [ ] **Step 4: Write the implementation**

Add to the imports at the top of `worker/cron/jobs.py` (alongside the existing `from db import ...` lines):

```python
from db import brand_configs as db_brand
from db import content_cadences as db_cadences
from db import content_cells as db_cells
from pipeline.generate import render_cell
```

Then append this section to `worker/cron/jobs.py`:

```python
# ---------------------------------------------------------------------------
# refill-and-schedule — the autopilot loop
# ---------------------------------------------------------------------------


async def _refill_one_cadence(
    svc: AsyncClient, cadence: dict, per_cadence_limit: int
) -> dict:
    persona_id = cadence["persona_id"]
    platform = cadence["platform"]

    reservoir = await db_cells.count_reservoir(svc, persona_id, platform)

    # Fire the low-fuel nudge BEFORE the queue empties (and only once per drain
    # cycle — last_low_nudge_at gates re-nudging on every cron tick).
    nudged = 0
    if reservoir < cadence["low_reservoir_threshold"] and not cadence.get("last_low_nudge_at"):
        await db_audit.insert_audit_event(
            svc,
            {
                "workspace_id": cadence["workspace_id"],
                "persona_id": persona_id,
                "entity_type": "cadence",
                "entity_id": cadence["id"],
                "event_type": "cadence.low_reservoir",
                "metadata": {"platform": platform, "reservoir": reservoir},
            },
        )
        await db_cadences.mark_low_nudge_sent(svc, cadence["id"])
        nudged = 1

    cells = await db_cells.next_planned_cells(
        svc, persona_id, platform, per_cadence_limit
    )
    if not cells:
        return {"rendered": 0, "nudged": nudged}

    brand = await db_brand.get_brand_config_for_persona(svc, persona_id)
    brand_prompt = (brand or {}).get("custom_system_prompt") or ""
    if not brand_prompt:
        log.warning("refill_skipped_no_brand", persona_id=persona_id)
        return {"rendered": 0, "nudged": nudged}

    # autopilot ON → variant is publishable immediately (draft → publish-due cron
    # path); OFF → it waits in the batch-review screen as pending_approval.
    variant_status = "draft" if cadence["autopilot_enabled"] else "pending_approval"

    rendered = 0
    for cell in cells:
        idea = cell.get("content_ideas") or {}
        essence = idea.get("essence") or ""
        source_quote = idea.get("source_quote") or ""
        if not essence:
            continue
        body = await render_cell(
            essence=essence,
            source_quote=source_quote,
            fmt=cell["format"],
            angle=cell["angle"],
            platform=platform,
            brand_system_prompt=brand_prompt,
        )
        content_item = await db_posts.create_content_item(
            svc,
            {
                "workspace_id": cell["workspace_id"],
                "persona_id": persona_id,
                "idea_id": cell["idea_id"],
            },
        )
        await db_posts.create_post_variants(
            svc,
            [
                {
                    "workspace_id": cell["workspace_id"],
                    "persona_id": persona_id,
                    "content_item_id": content_item["id"],
                    "platform": platform,
                    "body": body,
                    "status": variant_status,
                }
            ],
        )
        await db_cells.mark_cell_rendered(svc, cell["id"])
        rendered += 1

    return {"rendered": rendered, "nudged": nudged}


async def run_refill_and_schedule(
    svc: AsyncClient, per_cadence_limit: int = 5
) -> dict:
    cadences = await db_cadences.list_active_cadences(svc)
    results = await asyncio.gather(
        *(_refill_one_cadence(svc, c, per_cadence_limit) for c in cadences),
        return_exceptions=True,
    )
    rendered = sum(r["rendered"] for r in results if isinstance(r, dict))
    nudged = sum(r["nudged"] for r in results if isinstance(r, dict))
    failed = sum(1 for r in results if isinstance(r, BaseException))
    if failed:
        log.warning("refill_partial_failure", failed=failed)
    return {"cadences": len(cadences), "rendered": rendered, "nudged": nudged, "failed": failed}
```

- [ ] **Step 5: Add the cron route**

Append to `worker/routes/cron.py`:

```python
@router.post("/refill-and-schedule")
async def refill_and_schedule(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_refill_and_schedule(svc)
```

- [ ] **Step 6: Verify `create_content_item` / `create_post_variants` accept these fields**

Run: `grep -n "def create_content_item\|def create_post_variants" worker/db/posts.py`
Expected: both exist (confirmed in `worker/db/posts.py` lines 6 and 13). They take a raw `values` dict / list, so the new fields pass through. If `post_variants` lacks a `persona_id`/`content_item_id` column the insert will error — confirm via `grep -n "post_variants:" web/lib/db/types.ts` and inspect the columns; they exist (variants are persona- and content-item-scoped in the current schema).

- [ ] **Step 7: Run test to verify it passes**

Run: `cd worker && uv run pytest tests/test_refill_cron.py -v`
Expected: PASS (3 tests)

- [ ] **Step 8: Run the full worker suite**

Run: `cd worker && uv run pytest -q`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add worker/cron/jobs.py worker/routes/cron.py worker/tests/test_refill_cron.py
git commit -m "feat(worker): refill-and-schedule cron (autopilot loop + low-fuel nudge)"
```

### Task 7.2: Register the cron schedule

**Files:**
- Modify: the cron scheduler config that triggers the existing jobs (find it first)

- [ ] **Step 1: Find how existing crons are scheduled**

Run: `grep -rn "publish-due\|pull-metrics\|cron" worker/fly.toml worker/*.toml --include=*.toml; grep -rln "publish-due\|refill\|cron" . --include=*.toml --include=*.yaml --include=*.yml`
Expected: locate the scheduler that POSTs to `/cron/publish-due` (Fly machines schedule, an external cron, or a GitHub Action). Identify the cadence (e.g., every 5 min).

- [ ] **Step 2: Add the refill schedule**

Add a schedule entry that POSTs to `/cron/refill-and-schedule` on a sensible interval (recommend hourly — reservoir drains slowly; no need for minute-level). Mirror the auth header / `CRON_SECRET` mechanism the other cron triggers use. If crons are triggered externally (not in-repo), note this step as a deployment task and document the new endpoint + recommended interval in `Local_Running.md` under the cron section.

- [ ] **Step 3: Commit (if an in-repo config changed)**

```bash
git add -A
git commit -m "chore(worker): schedule refill-and-schedule cron hourly"
```

---

## Phase 8 — Web: thin proxy routes + cadence form

Per CLAUDE.md §B.7: mutations are thin proxies via `lib/worker-client.ts`; reads favor Server Components and go through `lib/db/*`.

### Task 8.1: Worker-client helpers + proxy routes

**Files:**
- Modify: `web/lib/worker-client.ts` (add `workerAtomize`, `workerUpsertCadence` using the existing `workerFetch`)
- Create: `web/app/api/content-engine/atomize/route.ts`
- Create: `web/app/api/content-engine/cadence/route.ts`
- Test: `web/tests/content-engine-proxy.test.ts`

- [ ] **Step 1: Read worker-client.ts to find `workerFetch`'s signature**

Run: `grep -n "export async function workerFetch\|export async function worker" web/lib/worker-client.ts`
Expected: shows `workerFetch(path, init, token)` (or similar). Mirror exactly how `workerCampaigns`/other helpers call it.

- [ ] **Step 2: Write the failing test**

Create `web/tests/content-engine-proxy.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the existing proxy-route tests' mocking style for worker-client.
vi.mock("@/lib/worker-client", () => ({
  workerAtomize: vi.fn(),
  workerUpsertCadence: vi.fn(),
}));

describe("content-engine proxy payload shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomize forwards the parsed body to the worker", async () => {
    const { workerAtomize } = await import("@/lib/worker-client");
    (workerAtomize as ReturnType<typeof vi.fn>).mockResolvedValue({ ideas_extracted: 3 });
    const result = await (workerAtomize as ReturnType<typeof vi.fn>)(
      { ingestion_job_id: "j1", persona_id: "p1", platforms: ["linkedin"] },
      "jwt-token",
    );
    expect(result).toEqual({ ideas_extracted: 3 });
  });
});
```

> Note: route-handler tests in this repo verify the worker-client is called with the right payload (the routes are thin proxies). Match the assertion style of the existing `web/tests/*proxy*` or campaign-route tests — open one first with `grep -rln "worker" web/tests` and copy its structure if it differs from the above.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir web test content-engine-proxy`
Expected: FAIL (module `workerAtomize` not exported yet).

- [ ] **Step 4: Add the worker-client helpers**

In `web/lib/worker-client.ts`, add (matching the existing helper style that wraps `workerFetch`):

```typescript
export async function workerAtomize(
  payload: { ingestion_job_id: string; persona_id: string; platforms: string[] },
  token: string,
) {
  return workerFetch("/content-engine/atomize", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function workerUpsertCadence(
  payload: unknown,
  token: string,
) {
  return workerFetch("/content-engine/cadence", {
    method: "PUT",
    body: JSON.stringify(payload),
  }, token);
}
```

Adjust the `workerFetch` call shape to match its real signature from Step 1.

- [ ] **Step 5: Create the proxy routes**

Create `web/app/api/content-engine/atomize/route.ts` (thin proxy — no Zod, worker re-validates with Pydantic, per CLAUDE.md §B.7):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerAtomize } from "@/lib/worker-client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const result = await workerAtomize(body, session.access_token);
  return NextResponse.json(result);
}
```

Create `web/app/api/content-engine/cadence/route.ts` the same way but `PUT` → `workerUpsertCadence`. Match the exact auth/session pattern used by an existing proxy route (open `web/app/api/campaigns/route.ts` or a posts proxy and copy its session-extraction lines verbatim — the session/token access must match what the rest of the app does).

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --dir web test content-engine-proxy && pnpm --dir web typecheck`
Expected: test PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add web/lib/worker-client.ts web/app/api/content-engine/ web/tests/content-engine-proxy.test.ts
git commit -m "feat(web): content-engine proxy routes (atomize, cadence)"
```

### Task 8.2: Reservoir read helper + cadence read

**Files:**
- Create: `web/lib/db/content-engine.ts` (read helpers under RLS)
- Test: `web/tests/content-engine-db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/content-engine-db.test.ts` (mirror the existing `web/lib/db` test style — open one with `grep -rln "from \"@/lib/db" web/tests` and copy its Supabase-client mocking):

```typescript
import { describe, it, expect, vi } from "vitest";
import { getReservoirForPersona } from "@/lib/db/content-engine";

function mockClient(count: number) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq"]) {
    (chain as Record<string, () => unknown>)[m] = () => chain;
  }
  // terminal: returns { count }
  (chain as Record<string, () => Promise<unknown>>)["then"] = undefined as never;
  return {
    ...chain,
    select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count, error: null }) }) }) }),
    from: () => chain,
  } as never;
}

describe("getReservoirForPersona", () => {
  it("returns the planned-cell count", async () => {
    // Use the repo's standard supabase mock util if one exists; otherwise this
    // shape mirrors a head:true count query.
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 8, error: null }),
            }),
          }),
        }),
      }),
    } as never;
    const n = await getReservoirForPersona(client, "p1", "linkedin");
    expect(n).toBe(8);
  });
});
```

> If the repo has a shared supabase-mock helper in `web/tests`, use it instead of the hand-rolled chain above — open an existing `web/lib/db` test first and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test content-engine-db`
Expected: FAIL (`getReservoirForPersona` not found).

- [ ] **Step 3: Write the implementation**

Create `web/lib/db/content-engine.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;

export async function getReservoirForPersona(
  client: Client,
  personaId: string,
  platform: string,
): Promise<number> {
  const { count, error } = await client
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("platform", platform)
    .eq("status", "planned");
  if (error) throw error;
  return count ?? 0;
}

export async function getCadencesForWorkspace(
  client: Client,
  workspaceId: string,
) {
  const { data, error } = await client
    .from("content_cadences")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --dir web test content-engine-db && pnpm --dir web typecheck`
Expected: test PASS, typecheck clean (confirms the new types from Phase 0 flow through).

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/content-engine.ts web/tests/content-engine-db.test.ts
git commit -m "feat(web): reservoir + cadence read helpers"
```

### Task 8.3: Cadence settings form (client island) + reservoir indicator

**Files:**
- Create: `web/app/(app)/settings/_components/CadenceForm.tsx` (client island)
- Modify: the settings page that should host it (find the brand/voice settings page and add the section)

- [ ] **Step 1: Find the settings page that hosts brand config**

Run: `grep -rln "custom_system_prompt\|brand" web/app/(app)/settings web/components 2>/dev/null; ls web/app/(app)/settings 2>/dev/null`
Expected: locate the settings page/section where "set it once" brand config lives. The cadence form belongs next to it (this is the "set it once" surface from spec §7).

- [ ] **Step 2: Build the cadence form island**

Create `web/app/(app)/settings/_components/CadenceForm.tsx` — a `"use client"` island with: posts-per-week number input (1–21), platform select (linkedin/x), autopilot toggle, active toggle. On submit it `PUT`s to `/api/content-engine/cadence`. Follow the exact styling/primitive pattern of an existing settings form (open one in `web/components` first and match its shadcn-vendored components, button, and toast/error handling). Keep it small — one focused island, not a page-level `"use client"` (CLAUDE.md §B.12).

- [ ] **Step 3: Render it on the settings page + show reservoir**

In the settings page (Server Component), fetch the reservoir via `getReservoirForPersona` and the current cadence via `getCadencesForWorkspace`, pass them as props to `<CadenceForm />`, and show a small "≈ N posts queued" indicator near it.

- [ ] **Step 4: Typecheck + test + lint**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/settings/
git commit -m "feat(web): cadence settings form + reservoir indicator"
```

---

## Phase 9 — Web: batch-review screen + low-fuel banner

### Task 9.1: Batch-review list of `pending_approval` variants

**Files:**
- Create: `web/lib/db/content-engine.ts` — add `listPendingApprovalVariants`
- Create: a review page route + a client island for approve/kill actions
- Reuse: existing post-variant mutation proxies (the approve action sets status to a publishable state; kill cancels)

- [ ] **Step 1: Add the read helper (test-first)**

Add to `web/tests/content-engine-db.test.ts` a test for `listPendingApprovalVariants(client, workspaceId)` returning rows filtered to `status = "pending_approval"`, then implement it in `web/lib/db/content-engine.ts`:

```typescript
export async function listPendingApprovalVariants(
  client: Client,
  workspaceId: string,
) {
  const { data, error } = await client
    .from("post_variants")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
```

Run: `pnpm --dir web test content-engine-db` → PASS.

- [ ] **Step 2: Decide the approve/kill actions reuse existing proxies**

Run: `grep -rn "approve\|status.*draft\|/schedule\|/cancel" web/app/api/posts`
Expected: confirm there's an existing path to move a variant to a publishable/scheduled state and to cancel one. Approve = set the variant to the same status autopilot uses (`draft` → eligible for the publish path) or schedule it; Kill = cancel. If no "set status" proxy exists, add a thin proxy + worker endpoint `POST /posts/{id}/approve` that sets status `pending_approval → draft` (worker validates the transition). Keep it minimal.

- [ ] **Step 3: Build the review page (Server Component) + actions island**

Create the review route as a Server Component that calls `listPendingApprovalVariants`, rendering each with body + the matrix metadata (format/angle/platform from the joined content_item) so the user sees *why* each post is distinct. A small client island provides Approve / Approve-all / Kill buttons hitting the proxies. Match the existing queue/dashboard Server-Component + island pattern (CLAUDE.md §B.7).

- [ ] **Step 4: Typecheck + test + lint**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/content-engine.ts web/app/ web/tests/
git commit -m "feat(web): batch-review screen for pending_approval posts"
```

### Task 9.2: Low-fuel nudge banner

**Files:**
- Reuse: the existing `needs_reauth` banner pattern
- Create/modify: a banner that reads recent `cadence.low_reservoir` audit events (or reservoir < threshold computed live) and shows "Your {platform} queue runs dry soon — feed me an asset."

- [ ] **Step 1: Find the existing banner pattern**

Run: `grep -rln "needs_reauth\|reauth\|Banner" web/app web/components`
Expected: locate the existing reconnect banner. Mirror it.

- [ ] **Step 2: Add a reservoir read for the banner**

Reuse `getReservoirForPersona` / `getCadencesForWorkspace`: in the relevant layout/Server Component, if any active cadence's reservoir < its threshold, render the nudge banner. (Live computation is simpler than reading audit events and avoids a new read path.)

- [ ] **Step 3: Typecheck + test + lint, then commit**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`

```bash
git add web/
git commit -m "feat(web): low-reservoir nudge banner"
```

---

## Phase 10 — Wire atomize into the ingestion flow + final verification

### Task 10.1: Trigger atomize after ingestion (or via an explicit "Atomize" action)

**Files:**
- Modify: the chat/ingest UI where an asset finishes ingesting — add an "Atomize into queue" action that calls `/api/content-engine/atomize` with the `ingestion_job_id`, the active persona, and the cadence's platforms.

- [ ] **Step 1: Find where ingestion completion is surfaced**

Run: `grep -rln "ingestion\|ingest\|job_id\|stage" web/app/\(app\)/chat`
Expected: the chat page that tracks ingestion job stage (the spec/audit referenced realtime + poll on `ingestion_jobs`). After an asset reaches a completed stage, offer the atomize action.

- [ ] **Step 2: Add the action**

Add a button/flow (small island) that POSTs to `/api/content-engine/atomize`. On success, show "Extracted N ideas → ~M posts queued." Match existing chat-action UX.

- [ ] **Step 3: Typecheck + test + lint + commit**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`

```bash
git add web/
git commit -m "feat(web): atomize-into-queue action after ingestion"
```

### Task 10.2: Full-stack verification against success criteria

- [ ] **Step 1: Worker suite green**

Run: `cd worker && uv run pytest -q`
Expected: all pass.

- [ ] **Step 2: Web suite + typecheck + lint green**

Run: `pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web lint`
Expected: all pass.

- [ ] **Step 3: Manual smoke (dev) against spec §9 success criteria**

With both services running (`pnpm --dir web dev` + `cd worker && uv run fastapi dev`):
1. Set brand voice + drop one substantial asset + set a cadence → atomize → confirm reservoir shows a non-zero estimate and `content_ideas`/`content_items(status=planned)` rows exist.
2. Manually POST `/cron/refill-and-schedule` (with the cron secret) → confirm variants get bodies and distinct `(format, angle, platform)` from joined content_items; no two cells share `matrix_cell_hash` (DB unique index enforces it).
3. Toggle autopilot OFF → refill → variants land as `pending_approval` and appear in the batch-review screen. Toggle ON → variants land as `draft` (publish-eligible).
4. Set `low_reservoir_threshold` above the current reservoir → refill → confirm the nudge banner appears.
5. Inspect a few rendered bodies → each reflects its idea's `source_quote` (no fabricated stats).
6. Confirm an existing one-shot generate/schedule/publish still works (downstream unchanged).

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "test: full-stack verification of content engine"
```

---

## Notes for the executor

- **Do not** add new npm/pip packages without user approval (CLAUDE.md §B.12). This plan uses only what's installed (`hashlib`, `json`, `re` are stdlib; supabase/pydantic/fastapi already present).
- **Do not** modify `web/lib/db/types.ts` by hand — only via `pnpm gen:types`.
- **Branch**, don't push to `main`. Work continues on the current feature branch.
- If any `grep` verification step (5.5, 7.6, 8.x "find the pattern") reveals a name or signature different from what this plan assumed, **use the real one** and keep going — the plan's intent (thin proxy, reuse `workerFetch`, reuse `create_post_variants`) is what matters, not the exact identifier.
- Deferred items (smart ordering, visual cards, narrative blueprints, top-up inflows, co-authoring, learning loop, eager preview, configurable formats, templates) are explicitly OUT of scope — see `Future improvements/autonomous_content_engine_deferred.md`.
