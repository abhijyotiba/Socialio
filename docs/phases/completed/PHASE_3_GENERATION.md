# Phase 3 — Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-pass LLM generation pipeline so a user can click "Generate post" after ingestion and receive platform-specific (LinkedIn / X) post drafts stored in the database.

**Architecture:** The Python worker gains a `/generate` endpoint that runs Pass 1 (summarise source with Groq, Gemini fallback) then Pass 2 (generate platform variants using the workspace's brand system prompt). The web route `POST /api/posts` calls the worker synchronously, writes `content_items` + `post_variants` to Supabase, and advances `ingestion_jobs.stage` through `analyzing → generating → storing → done`. The chat page subscribes to those stage updates via Supabase Realtime and shows the variants when done.

**Tech Stack:** Groq SDK (`groq>=0.9`, primary LLM), Google Generative AI (`google-generativeai>=0.8`, fallback), FastAPI, Supabase JS Realtime (browser), Zod, Vitest, pytest.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `supabase/migrations/0004_generation.sql` | `content_items` + `post_variants` tables, RLS, triggers, indexes |
| `worker/adapters/groq.py` | Async Groq chat-completions wrapper |
| `worker/adapters/gemini.py` | Async Gemini generate_content wrapper |
| `worker/adapters/llm.py` | Unified `generate(system, user)` — tries Groq, falls back to Gemini |
| `worker/pipeline/analyze.py` | Pass 1: extracted text → concise summary |
| `worker/pipeline/generate.py` | Pass 2: summary + brand prompt + platform → post body |
| `worker/routes/generate.py` | `POST /generate` endpoint, Pydantic models, delegates to pipeline |
| `worker/tests/test_llm.py` | Unit tests for Groq/Gemini/fallback logic |
| `worker/tests/test_generate_pipeline.py` | Unit tests for analyze + generate pipeline functions |
| `web/lib/db/posts.ts` | `createContentItem`, `updateContentItem`, `createPostVariants`, `getContentItemWithVariants`, `listContentItemsForJob` |
| `web/app/api/posts/route.ts` | `POST /api/posts` — auth, Zod, worker call, DB writes |
| `web/lib/supabase/browser.ts` | Browser-side Supabase client for Realtime |
| `web/tests/db.posts.test.ts` | Type-level Vitest tests for `content_items` + `post_variants` |

### Modified files
| File | Change |
|---|---|
| `worker/config.py` | Add `groq_api_key`, `gemini_api_key`, `groq_model`, `gemini_model` fields |
| `worker/pyproject.toml` | Add `groq>=0.9`, `google-generativeai>=0.8` |
| `worker/main.py` | Register `generate_router` |
| `web/lib/worker-client.ts` | Add `WorkerGenerateRequest`, `WorkerVariantOutput`, `WorkerGenerateResponse`, `workerGenerate()` |
| `web/lib/db/types.ts` | Regenerated after migration |
| `web/app/(app)/chat/page.tsx` | Enable Generate button, platform picker, Realtime stage display, variants panel |
| `worker/.env` | Add `GROQ_API_KEY`, `GEMINI_API_KEY` (local only, gitignored) |
| `.env.example` | Add `GROQ_API_KEY`, `GEMINI_API_KEY` |
| `docs/DATA_MODEL.md` | Add Phase 3 section |
| `docs/API_CONTRACTS.md` | Add `POST /api/posts` contract |
| `CLAUDE.md` | Bump current phase to Phase 3 |
| `docs/SESSION_NOTES.md` | New top entry |

---

## Task 1: Commit the linkedin-scope fix and create the Phase 3 branch

**Files:** none (git operations only)

- [ ] **Step 1: Commit the linkedin test fix**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add web/tests/adapters.linkedin.test.ts
git commit -m "fix: update linkedin scope test to match narrowed openid-only scope"
```

- [ ] **Step 2: Create and switch to Phase 3 branch**

```bash
git checkout -b feat/phase-3-generation
```

- [ ] **Step 3: Verify clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean` on branch `feat/phase-3-generation`.

---

## Task 2: DB migration — content_items + post_variants

**Files:**
- Create: `supabase/migrations/0004_generation.sql`
- Modify: `web/lib/db/types.ts` (regenerated)
- Modify: `docs/DATA_MODEL.md`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_generation.sql`:

```sql
-- Phase 3: generation pipeline tables

-- content_items: one row per "generate" action. Links ingestion → variants.
CREATE TABLE public.content_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ingestion_job_id  UUID REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL,
  prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  summary           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_items_member_select" ON public.content_items
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "content_items_member_insert" ON public.content_items
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "content_items_member_update" ON public.content_items
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_content_items_workspace ON public.content_items(workspace_id);
CREATE INDEX idx_content_items_job       ON public.content_items(ingestion_job_id);

-- post_variants: one row per platform per content_item. Has its own status machine.
CREATE TABLE public.post_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id  UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  claimed_at       TIMESTAMPTZ,
  worker_id        TEXT,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_variants_member_select" ON public.post_variants
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_variants_member_insert" ON public.post_variants
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "post_variants_member_update" ON public.post_variants
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_post_variants_workspace     ON public.post_variants(workspace_id);
CREATE INDEX idx_post_variants_content_item  ON public.post_variants(content_item_id);
CREATE INDEX idx_post_variants_status        ON public.post_variants(status);
CREATE INDEX idx_post_variants_scheduled     ON public.post_variants(scheduled_at)
  WHERE status = 'scheduled';

-- updated_at trigger for post_variants
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_post_variants_updated_at
  BEFORE UPDATE ON public.post_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

- [ ] **Step 2: Apply the migration**

```bash
pnpm --dir web supabase db push --workdir ..
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
pnpm --dir web gen:types
```

Expected: `web/lib/db/types.ts` updated to include `content_items` and `post_variants`.

- [ ] **Step 4: Verify types contain both new tables**

Open `web/lib/db/types.ts` and confirm both `content_items` and `post_variants` appear under `public > Tables`.

- [ ] **Step 5: Update DATA_MODEL.md**

Append this section to `docs/DATA_MODEL.md` before the "Conventions for future tables" section:

```markdown
## Phase 3 — Generation

Migration: `supabase/migrations/0004_generation.sql`

### `content_items`

One row per "generate" action. Links an ingestion job to its generated variants and records which prompt version produced them.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `ingestion_job_id` | `UUID` | FK `ingestion_jobs(id)`, SET NULL on delete |
| `prompt_version_id` | `UUID` | FK `prompt_versions(id)`, SET NULL on delete. Snapshot of which brand prompt was active |
| `summary` | `TEXT` | Pass-1 LLM output: condensed summary of the source content |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |

**RLS:** workspace members can select, insert, update.

**Indexes:** `idx_content_items_workspace`, `idx_content_items_job`.

### `post_variants`

One row per platform per content_item. Each row is a generated post draft with its own publishing state machine.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `content_item_id` | `UUID` NOT NULL | FK `content_items(id)`, cascade delete |
| `platform` | `TEXT` NOT NULL | CHECK `IN ('linkedin', 'x')` |
| `body` | `TEXT` NOT NULL | Generated post text |
| `status` | `TEXT` NOT NULL | Default `'draft'`. CHECK `IN ('draft','scheduled','publishing','published','failed','cancelled')` |
| `scheduled_at` | `TIMESTAMPTZ` | Populated when user schedules |
| `published_at` | `TIMESTAMPTZ` | Set on successful publish |
| `claimed_at` | `TIMESTAMPTZ` | Set by cron when it claims the row for publishing |
| `worker_id` | `TEXT` | Cron instance that claimed this row |
| `error` | `TEXT` | Last error message if status = 'failed' |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| `updated_at` | `TIMESTAMPTZ` NOT NULL | Maintained by trigger `trg_post_variants_updated_at` |

**RLS:** workspace members can select, insert, update.

**Indexes:** `idx_post_variants_workspace`, `idx_post_variants_content_item`, `idx_post_variants_status`, `idx_post_variants_scheduled` (partial, WHERE status = 'scheduled').
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0004_generation.sql web/lib/db/types.ts docs/DATA_MODEL.md
git commit -m "feat: migration 0004 — content_items and post_variants tables"
```

---

## Task 3: Worker — add LLM dependencies and config

**Files:**
- Modify: `worker/pyproject.toml`
- Modify: `worker/config.py`
- Modify: `worker/.env` (local only, gitignored)
- Modify: `.env.example`

- [ ] **Step 1: Add LLM packages to pyproject.toml**

In `worker/pyproject.toml`, add to the `dependencies` list:

```toml
    "groq>=0.9",
    "google-generativeai>=0.8",
```

Full dependencies section should look like:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "playwright>=1.44",
    "httpx>=0.27",
    "cloudinary>=1.40",
    "beautifulsoup4>=4.12",
    "lxml>=5.2",
    "pydantic>=2.7",
    "pydantic-settings>=2.2",
    "structlog>=24.1",
    "groq>=0.9",
    "google-generativeai>=0.8",
]
```

- [ ] **Step 2: Run uv sync**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv sync
```

Expected: resolves and installs groq and google-generativeai. Commit the updated `uv.lock`.

- [ ] **Step 3: Update worker/config.py**

Replace the entire contents of `worker/config.py`:

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    worker_shared_secret: str
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str
    playwright_timeout_ms: int = 20000

    groq_api_key: str
    groq_model: str = "llama-3.1-70b-versatile"
    gemini_api_key: str
    gemini_model: str = "gemini-1.5-flash"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

- [ ] **Step 4: Add env vars to worker/.env (local dev)**

Open `worker/.env` and add:

```
GROQ_API_KEY=<your-groq-api-key>
GEMINI_API_KEY=<your-gemini-api-key>
```

Get keys from https://console.groq.com and https://aistudio.google.com/app/apikey.

- [ ] **Step 5: Add env vars to .env.example (root)**

In `.env.example`, add:

```bash
# LLM providers (worker)
GROQ_API_KEY=               # Groq console: console.groq.com
GEMINI_API_KEY=             # Google AI Studio: aistudio.google.com/app/apikey
```

- [ ] **Step 6: Update worker/tests/conftest.py**

Open `worker/tests/conftest.py` and add the new env vars alongside existing ones:

```python
import os

os.environ.setdefault("WORKER_SHARED_SECRET", "test-secret")
os.environ.setdefault("CLOUDINARY_CLOUD_NAME", "test-cloud")
os.environ.setdefault("CLOUDINARY_API_KEY", "test-key")
os.environ.setdefault("CLOUDINARY_API_SECRET", "test-secret")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
```

- [ ] **Step 7: Verify existing tests still pass**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/ -v
```

Expected: 17/17 passing.

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add worker/pyproject.toml worker/uv.lock worker/config.py worker/tests/conftest.py .env.example
git commit -m "feat: add Groq + Gemini dependencies and config fields"
```

---

## Task 4: Worker — LLM adapters (groq, gemini, unified llm)

**Files:**
- Create: `worker/adapters/__init__.py`
- Create: `worker/adapters/groq.py`
- Create: `worker/adapters/gemini.py`
- Create: `worker/adapters/llm.py`
- Create: `worker/tests/test_llm.py`

- [ ] **Step 1: Write the failing tests**

Create `worker/tests/test_llm.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_groq_adapter_returns_text():
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "Generated text"

    with patch("adapters.groq.AsyncGroq") as MockClient:
        instance = MockClient.return_value
        instance.chat = MagicMock()
        instance.chat.completions = MagicMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from adapters.groq import groq_generate
        result = await groq_generate("system prompt", "user message")
        assert result == "Generated text"
        instance.chat.completions.create.assert_called_once()
        call_kwargs = instance.chat.completions.create.call_args[1]
        assert call_kwargs["messages"][0]["role"] == "system"
        assert call_kwargs["messages"][0]["content"] == "system prompt"
        assert call_kwargs["messages"][1]["role"] == "user"
        assert call_kwargs["messages"][1]["content"] == "user message"


@pytest.mark.asyncio
async def test_gemini_adapter_returns_text():
    mock_response = MagicMock()
    mock_response.text = "Gemini generated text"

    with patch("adapters.gemini.genai") as mock_genai:
        mock_model = MagicMock()
        mock_genai.GenerativeModel.return_value = mock_model
        mock_model.generate_content_async = AsyncMock(return_value=mock_response)

        from adapters.gemini import gemini_generate
        result = await gemini_generate("system prompt", "user message")
        assert result == "Gemini generated text"


@pytest.mark.asyncio
async def test_llm_uses_groq_primary():
    with patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq:
        mock_groq.return_value = "Groq result"

        from adapters.llm import generate
        result = await generate("sys", "user")
        assert result == "Groq result"
        mock_groq.assert_called_once_with("sys", "user")


@pytest.mark.asyncio
async def test_llm_falls_back_to_gemini_when_groq_fails():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq rate limit")
        mock_gemini.return_value = "Gemini fallback result"

        from adapters.llm import generate
        result = await generate("sys", "user")
        assert result == "Gemini fallback result"
        mock_gemini.assert_called_once_with("sys", "user")


@pytest.mark.asyncio
async def test_llm_raises_if_both_fail():
    with (
        patch("adapters.llm.groq_generate", new_callable=AsyncMock) as mock_groq,
        patch("adapters.llm.gemini_generate", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_groq.side_effect = Exception("Groq down")
        mock_gemini.side_effect = Exception("Gemini down")

        from adapters.llm import generate
        with pytest.raises(Exception, match="Gemini down"):
            await generate("sys", "user")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/test_llm.py -v
```

Expected: collection error or ImportError — adapters don't exist yet.

- [ ] **Step 3: Create worker/adapters/__init__.py**

```python
```

(empty file)

- [ ] **Step 4: Create worker/adapters/groq.py**

```python
from groq import AsyncGroq
from config import get_settings


async def groq_generate(system_prompt: str, user_message: str) -> str:
    settings = get_settings()
    client = AsyncGroq(api_key=settings.groq_api_key)
    response = await client.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        max_tokens=1024,
        temperature=0.7,
    )
    return response.choices[0].message.content or ""
```

- [ ] **Step 5: Create worker/adapters/gemini.py**

```python
import google.generativeai as genai
from config import get_settings


async def gemini_generate(system_prompt: str, user_message: str) -> str:
    settings = get_settings()
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        settings.gemini_model,
        system_instruction=system_prompt,
    )
    response = await model.generate_content_async(user_message)
    return response.text
```

- [ ] **Step 6: Create worker/adapters/llm.py**

```python
import structlog

from adapters.groq import groq_generate
from adapters.gemini import gemini_generate

logger = structlog.get_logger()


async def generate(system_prompt: str, user_message: str) -> str:
    """Call Groq; fall back to Gemini on any exception."""
    try:
        return await groq_generate(system_prompt, user_message)
    except Exception as exc:
        logger.warning("groq_failed_falling_back_to_gemini", error=str(exc))
        return await gemini_generate(system_prompt, user_message)
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/test_llm.py -v
```

Expected: 5/5 passing.

- [ ] **Step 8: Run all worker tests**

```bash
uv run pytest tests/ -v
```

Expected: 22/22 passing.

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add worker/adapters/ worker/tests/test_llm.py
git commit -m "feat: Groq + Gemini LLM adapters with fallback"
```

---

## Task 5: Worker — pipeline/analyze.py and pipeline/generate.py

**Files:**
- Create: `worker/pipeline/analyze.py`
- Create: `worker/pipeline/generate.py`
- Create: `worker/tests/test_generate_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Create `worker/tests/test_generate_pipeline.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch


# ─── analyze tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_analyze_calls_llm_with_title_and_text():
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "• Point 1\n• Point 2"
        from pipeline.analyze import summarize
        result = await summarize("Article Title", "Long article body text here.")
        assert result == "• Point 1\n• Point 2"
        call_kwargs = mock_gen.call_args[1]
        assert "Article Title" in call_kwargs["user_message"]
        assert "Long article body text here." in call_kwargs["user_message"]


@pytest.mark.asyncio
async def test_analyze_truncates_long_text():
    long_text = "x" * 20000
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "summary"
        from pipeline.analyze import summarize
        await summarize("Title", long_text)
        call_kwargs = mock_gen.call_args[1]
        # user_message must not exceed ~12000 chars (8000 char text limit + overhead)
        assert len(call_kwargs["user_message"]) < 12000


@pytest.mark.asyncio
async def test_analyze_handles_empty_title():
    with patch("pipeline.analyze.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "summary"
        from pipeline.analyze import summarize
        result = await summarize("", "Some content")
        assert result == "summary"
        call_kwargs = mock_gen.call_args[1]
        assert "Some content" in call_kwargs["user_message"]


# ─── generate tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_linkedin_variant():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Great LinkedIn post text here."
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="Key points about AI.",
            brand_system_prompt="Write posts in a professional tone.",
            platforms=["linkedin"],
        )
        assert len(variants) == 1
        assert variants[0]["platform"] == "linkedin"
        assert variants[0]["body"] == "Great LinkedIn post text here."
        call_kwargs = mock_gen.call_args[1]
        assert "linkedin" in call_kwargs["user_message"].lower()
        assert "Key points about AI." in call_kwargs["user_message"]


@pytest.mark.asyncio
async def test_generate_x_variant():
    with patch("pipeline.generate.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Short X post."
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="Key points.",
            brand_system_prompt="Be concise.",
            platforms=["x"],
        )
        assert len(variants) == 1
        assert variants[0]["platform"] == "x"
        call_kwargs = mock_gen.call_args[1]
        assert "280 characters" in call_kwargs["user_message"] or "Twitter" in call_kwargs["user_message"] or "X/" in call_kwargs["user_message"]


@pytest.mark.asyncio
async def test_generate_multiple_platforms_calls_llm_once_per_platform():
    call_count = 0

    async def fake_generate(**kwargs):
        nonlocal call_count
        call_count += 1
        return f"Post for {call_count}"

    with patch("pipeline.generate.generate", side_effect=fake_generate):
        from pipeline.generate import generate_variants
        variants = await generate_variants(
            summary="summary",
            brand_system_prompt="brand prompt",
            platforms=["linkedin", "x"],
        )
        assert len(variants) == 2
        assert call_count == 2
        platforms = {v["platform"] for v in variants}
        assert platforms == {"linkedin", "x"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/test_generate_pipeline.py -v
```

Expected: ImportError — pipeline modules don't exist.

- [ ] **Step 3: Create worker/pipeline/analyze.py**

```python
from adapters.llm import generate

_SYSTEM = (
    "You are a content analyst. Read the article below and extract the key points "
    "in 3-5 concise bullet points. Focus on the main message, notable facts, and "
    "angles that would make compelling social media posts. Return only the bullet "
    "points — no preamble, no headers."
)

_MAX_TEXT_CHARS = 8000


async def summarize(title: str, text: str) -> str:
    truncated = text[:_MAX_TEXT_CHARS]
    title_line = f"Title: {title}\n\n" if title else ""
    user_message = f"{title_line}Article:\n{truncated}"
    return await generate(system_prompt=_SYSTEM, user_message=user_message)
```

- [ ] **Step 4: Create worker/pipeline/generate.py**

```python
from adapters.llm import generate

_PLATFORM_HINTS: dict[str, str] = {
    "linkedin": (
        "LinkedIn post (professional tone, 150–300 words, use line breaks for "
        "readability, may use 2–3 relevant emojis, end with a question or call-to-action)"
    ),
    "x": (
        "X/Twitter post (punchy, under 280 characters, conversational, "
        "no hashtag stuffing — at most 1–2 relevant hashtags)"
    ),
}


async def generate_variants(
    summary: str,
    brand_system_prompt: str,
    platforms: list[str],
) -> list[dict[str, str]]:
    results = []
    for platform in platforms:
        hint = _PLATFORM_HINTS.get(platform, platform)
        user_message = (
            f"Write a {hint} based on the following content summary.\n\n"
            f"Content summary:\n{summary}\n\n"
            "Return only the post text — no labels, no quotation marks."
        )
        body = await generate(system_prompt=brand_system_prompt, user_message=user_message)
        results.append({"platform": platform, "body": body.strip()})
    return results
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/test_generate_pipeline.py -v
```

Expected: 6/6 passing.

- [ ] **Step 6: Run all worker tests**

```bash
uv run pytest tests/ -v
```

Expected: 28/28 passing.

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add worker/pipeline/analyze.py worker/pipeline/generate.py worker/tests/test_generate_pipeline.py
git commit -m "feat: analyze (Pass 1) and generate (Pass 2) pipeline functions"
```

---

## Task 6: Worker — POST /generate route

**Files:**
- Create: `worker/routes/generate.py`
- Modify: `worker/main.py`

- [ ] **Step 1: Create worker/routes/generate.py**

```python
import time
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from auth import verify_hmac
from pipeline import analyze, generate as gen_pipeline

router = APIRouter()


class GenerateRequest(BaseModel):
    job_id: str
    workspace_id: str
    extracted_title: str
    extracted_text: str
    brand_system_prompt: str
    platforms: list[Literal["linkedin", "x"]]


class VariantOutput(BaseModel):
    platform: str
    body: str


class GenerateResponse(BaseModel):
    summary: str
    variants: list[VariantOutput]
    stage_timings: dict[str, int]


def _ms() -> int:
    return int(time.monotonic() * 1000)


@router.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest, request: Request) -> GenerateResponse:
    body = await request.body()
    await verify_hmac(request, body)

    t0 = _ms()
    summary = await analyze.summarize(req.extracted_title, req.extracted_text)
    t1 = _ms()

    raw_variants = await gen_pipeline.generate_variants(
        summary=summary,
        brand_system_prompt=req.brand_system_prompt,
        platforms=req.platforms,
    )
    t2 = _ms()

    return GenerateResponse(
        summary=summary,
        variants=[VariantOutput(**v) for v in raw_variants],
        stage_timings={
            "analyzing": t1 - t0,
            "generating": t2 - t1,
        },
    )
```

- [ ] **Step 2: Register the router in worker/main.py**

Replace `worker/main.py` contents:

```python
from fastapi import FastAPI

from routes.ingest import router as ingest_router
from routes.generate import router as generate_router

app = FastAPI(title="SocialOS Worker", version="0.1.0")
app.include_router(ingest_router)
app.include_router(generate_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Verify the worker starts without error**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run python -c "from main import app; print('OK')"
```

Expected: prints `OK` with no import errors.

- [ ] **Step 4: Run all worker tests**

```bash
uv run pytest tests/ -v
```

Expected: 28/28 passing.

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add worker/routes/generate.py worker/main.py
git commit -m "feat: POST /generate worker route"
```

---

## Task 7: Web — extend worker-client.ts and add db/posts.ts

**Files:**
- Modify: `web/lib/worker-client.ts`
- Create: `web/lib/db/posts.ts`
- Create: `web/tests/db.posts.test.ts`

- [ ] **Step 1: Write the failing db tests**

Create `web/tests/db.posts.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/db/types";

type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
type ContentItemInsert = Database["public"]["Tables"]["content_items"]["Insert"];
type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];
type PostVariantInsert = Database["public"]["Tables"]["post_variants"]["Insert"];

describe("content_items types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<ContentItemRow>().toHaveProperty("id");
    expectTypeOf<ContentItemRow>().toHaveProperty("workspace_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("ingestion_job_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("prompt_version_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("summary");
    expectTypeOf<ContentItemRow>().toHaveProperty("created_at");
  });

  it("Insert type allows null for optional FK columns", () => {
    expectTypeOf<ContentItemInsert["ingestion_job_id"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<ContentItemInsert["prompt_version_id"]>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});

describe("post_variants types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<PostVariantRow>().toHaveProperty("id");
    expectTypeOf<PostVariantRow>().toHaveProperty("workspace_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("content_item_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("platform");
    expectTypeOf<PostVariantRow>().toHaveProperty("body");
    expectTypeOf<PostVariantRow>().toHaveProperty("status");
    expectTypeOf<PostVariantRow>().toHaveProperty("scheduled_at");
    expectTypeOf<PostVariantRow>().toHaveProperty("created_at");
    expectTypeOf<PostVariantRow>().toHaveProperty("updated_at");
  });

  it("Insert type has workspace_id, content_item_id, platform, body as required-ish", () => {
    expectTypeOf<PostVariantInsert["body"]>().toEqualTypeOf<string>();
    expectTypeOf<PostVariantInsert["platform"]>().toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
pnpm --dir web test tests/db.posts.test.ts
```

Expected: tests pass (type-level tests; they will pass once types are regenerated from Task 2).

- [ ] **Step 3: Extend web/lib/worker-client.ts**

Append to the end of `web/lib/worker-client.ts`:

```typescript
export interface WorkerVariantOutput {
  platform: string;
  body: string;
}

export interface WorkerGenerateRequest {
  job_id: string;
  workspace_id: string;
  extracted_title: string;
  extracted_text: string;
  brand_system_prompt: string;
  platforms: ("linkedin" | "x")[];
}

export interface WorkerGenerateResponse {
  summary: string;
  variants: WorkerVariantOutput[];
  stage_timings: Record<string, number>;
}

export async function workerGenerate(
  req: WorkerGenerateRequest
): Promise<WorkerGenerateResponse> {
  const body = JSON.stringify(req);
  const res = await fetch(`${process.env.WORKER_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Worker /generate responded ${res.status}`);
  }
  return res.json() as Promise<WorkerGenerateResponse>;
}
```

- [ ] **Step 4: Create web/lib/db/posts.ts**

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
type ContentItemInsert =
  Database["public"]["Tables"]["content_items"]["Insert"];
type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];
type PostVariantInsert =
  Database["public"]["Tables"]["post_variants"]["Insert"];

export async function createContentItem(
  values: ContentItemInsert
): Promise<ContentItemRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateContentItem(
  id: string,
  patch: Partial<ContentItemRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_items")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function createPostVariants(
  variants: PostVariantInsert[]
): Promise<PostVariantRow[]> {
  if (variants.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .insert(variants)
    .select();
  if (error) throw error;
  return data;
}

export async function getContentItemWithVariants(
  id: string
): Promise<{ content_item: ContentItemRow; variants: PostVariantRow[] } | null> {
  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemError || !item) return null;

  const { data: variants, error: variantsError } = await supabase
    .from("post_variants")
    .select("*")
    .eq("content_item_id", id)
    .order("created_at");
  if (variantsError) return null;

  return { content_item: item, variants: variants ?? [] };
}

export async function listContentItemsForJob(
  jobId: string
): Promise<ContentItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("ingestion_job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
```

- [ ] **Step 5: Run typecheck**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
pnpm --dir web typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Run all web tests**

```bash
pnpm --dir web test
```

Expected: 18/18 passing (17 original + 1 new test file with multiple tests).

- [ ] **Step 7: Commit**

```bash
git add web/lib/worker-client.ts web/lib/db/posts.ts web/tests/db.posts.test.ts
git commit -m "feat: workerGenerate client + posts db layer"
```

---

## Task 8: Web — POST /api/posts route

**Files:**
- Create: `web/app/api/posts/route.ts`
- Modify: `docs/API_CONTRACTS.md`

- [ ] **Step 1: Create web/app/api/posts/route.ts**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getIngestionJob, updateIngestionJob } from "@/lib/db/ingestion";
import { getBrandConfig } from "@/lib/db/brand";
import {
  createContentItem,
  updateContentItem,
  createPostVariants,
} from "@/lib/db/posts";
import { workerGenerate } from "@/lib/worker-client";

const bodySchema = z.object({
  ingestion_job_id: z.string().uuid(),
  platforms: z
    .array(z.enum(["linkedin", "x"]))
    .min(1, "At least one platform required"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }
  const workspaceId = workspace.workspace_id;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ingestion_job_id, platforms } = parsed.data;

  // Verify the job belongs to this workspace and is done
  const job = await getIngestionJob(ingestion_job_id);
  if (!job) {
    return NextResponse.json({ error: "Ingestion job not found" }, { status: 404 });
  }
  if (job.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.stage !== "done") {
    return NextResponse.json(
      { error: "Ingestion job is not ready (stage must be done)" },
      { status: 409 }
    );
  }

  // Get brand config for the system prompt
  const brand = await getBrandConfig(workspaceId);
  if (!brand || !brand.custom_system_prompt) {
    return NextResponse.json(
      { error: "Brand config with system prompt is required before generating" },
      { status: 409 }
    );
  }

  // Create the content_item row (without summary yet — updated after worker responds)
  const contentItem = await createContentItem({
    workspace_id: workspaceId,
    ingestion_job_id,
    prompt_version_id: brand.current_prompt_version_id ?? null,
  });

  // Advance job stage through the LLM pipeline
  await updateIngestionJob(ingestion_job_id, { stage: "analyzing" });

  try {
    const result = await workerGenerate({
      job_id: ingestion_job_id,
      workspace_id: workspaceId,
      extracted_title: job.extracted_title ?? "",
      extracted_text: job.extracted_text ?? "",
      brand_system_prompt: brand.custom_system_prompt,
      platforms,
    });

    await updateIngestionJob(ingestion_job_id, { stage: "storing" });

    // Persist the summary back onto the content_item
    await updateContentItem(contentItem.id, { summary: result.summary });

    // Create one post_variant per platform
    const variants = await createPostVariants(
      result.variants.map((v) => ({
        workspace_id: workspaceId,
        content_item_id: contentItem.id,
        platform: v.platform,
        body: v.body,
        status: "draft" as const,
      }))
    );

    await updateIngestionJob(ingestion_job_id, {
      stage: "done",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      content_item_id: contentItem.id,
      variants: variants.map((v) => ({
        id: v.id,
        platform: v.platform,
        body: v.body,
        status: v.status,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    await updateIngestionJob(ingestion_job_id, { stage: "failed", error: message });
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Check getBrandConfig exists in web/lib/db/brand.ts**

Run:

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
grep -n "getBrandConfig" web/lib/db/brand.ts
```

If `getBrandConfig` does not exist, add it to `web/lib/db/brand.ts`:

```typescript
export async function getBrandConfig(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();
  if (error) return null;
  return data;
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --dir web typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Update API_CONTRACTS.md**

Append to `docs/API_CONTRACTS.md`:

```markdown
---

## Phase 3

### POST /api/posts

Auth: authenticated user  
Used by: `/chat` page "Generate post" button  
Request:
```ts
{
  ingestion_job_id: string   // UUID, must be stage = 'done'
  platforms: ("linkedin" | "x")[]  // at least one
}
```
Response 200:
```ts
{
  content_item_id: string
  variants: Array<{
    id: string
    platform: "linkedin" | "x"
    body: string
    status: "draft"
  }>
}
```
Side effects:
- `content_items` row created and updated with LLM summary
- `post_variants` rows created (one per platform)
- `ingestion_jobs.stage` advanced: `analyzing → generating → storing → done`

Errors: `400` validation, `401` unauthenticated, `403` wrong workspace, `404` job not found, `409` job not ready or missing brand config, `502` worker error
```

- [ ] **Step 5: Commit**

```bash
git add web/app/api/posts/route.ts web/lib/db/brand.ts docs/API_CONTRACTS.md
git commit -m "feat: POST /api/posts — generate variants via worker"
```

---

## Task 9: Web — Chat UI — enable Generate flow with Realtime stage updates

**Files:**
- Create: `web/lib/supabase/browser.ts`
- Modify: `web/app/(app)/chat/page.tsx`

- [ ] **Step 1: Create browser Supabase client**

Create `web/lib/supabase/browser.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Read the current chat page**

Read `web/app/(app)/chat/page.tsx` in full before editing.

- [ ] **Step 3: Replace chat page with full Generation-capable implementation**

Replace the entire contents of `web/app/(app)/chat/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// ─── Types ────────────────────────────────────────────────────────────────────

type IngestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "success";
      jobId: string;
      title: string;
      text: string;
      media: { cloudinary_url: string; cloudinary_id: string }[];
    };

type GenerateState =
  | { kind: "idle" }
  | { kind: "loading"; stage: string }
  | { kind: "error"; message: string }
  | {
      kind: "success";
      variants: { id: string; platform: string; body: string }[];
    };

const STAGE_LABELS: Record<string, string> = {
  analyzing: "Analyzing content…",
  generating: "Writing posts…",
  storing: "Saving drafts…",
  done: "Done!",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [ingest, setIngest] = useState<IngestState>({ kind: "idle" });
  const [gen, setGen] = useState<GenerateState>({ kind: "idle" });
  const [showMore, setShowMore] = useState(false);
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>(["linkedin"]);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createBrowserSupabase>["channel"]
  > | null>(null);

  // Subscribe to job stage changes while generating
  useEffect(() => {
    if (ingest.kind !== "success" || gen.kind !== "loading") return;

    const supabase = createBrowserSupabase();
    const jobId = ingest.jobId;

    const channel = supabase
      .channel(`gen-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ingestion_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const stage = (payload.new as { stage: string }).stage;
          setGen((prev) =>
            prev.kind === "loading" ? { kind: "loading", stage } : prev
          );
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [ingest, gen.kind]);

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const isUrl =
      input.trim().startsWith("http://") || input.trim().startsWith("https://");
    setIngest({ kind: "loading" });
    setGen({ kind: "idle" });

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: isUrl ? "url" : "text",
          ...(isUrl ? { source_url: input.trim() } : { source_text: input.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIngest({ kind: "error", message: data.error ?? "Extraction failed." });
        return;
      }
      setIngest({
        kind: "success",
        jobId: data.job_id,
        title: data.extracted_title,
        text: data.extracted_text,
        media: data.media,
      });
    } catch {
      setIngest({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleGenerate() {
    if (ingest.kind !== "success") return;
    if (platforms.length === 0) return;

    setGen({ kind: "loading", stage: "analyzing" });

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingestion_job_id: ingest.jobId,
          platforms,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGen({ kind: "error", message: data.error ?? "Generation failed." });
        return;
      }
      setGen({ kind: "success", variants: data.variants });
    } catch {
      setGen({ kind: "error", message: "Network error. Please try again." });
    }
  }

  function togglePlatform(p: "linkedin" | "x") {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  const isExtractionLoading = ingest.kind === "loading";
  const isGenerationLoading = gen.kind === "loading";
  const extractionDone = ingest.kind === "success";

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-2xl font-semibold">New post</h1>

      {/* ── Extraction form ── */}
      <form onSubmit={handleIngest} className="space-y-3">
        <textarea
          className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Paste a URL or describe what you want to post about…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isExtractionLoading || isGenerationLoading}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleIngest(e as unknown as React.FormEvent);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isExtractionLoading || isGenerationLoading || !input.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {isExtractionLoading ? "Extracting…" : "Extract"}
          </button>
          <span className="text-xs text-muted-foreground">⌘+Enter</span>
        </div>
      </form>

      {/* ── Extraction error ── */}
      {ingest.kind === "error" && (
        <p className="text-sm text-destructive">{ingest.message}</p>
      )}

      {/* ── Extraction result ── */}
      {extractionDone && ingest.kind === "success" && (
        <div className="space-y-4 border rounded-lg p-4">
          {ingest.title && (
            <p className="font-semibold text-base">{ingest.title}</p>
          )}

          {ingest.text && (
            <div className="text-sm text-muted-foreground">
              <p>
                {showMore ? ingest.text : ingest.text.slice(0, 400)}
                {ingest.text.length > 400 && !showMore && "…"}
              </p>
              {ingest.text.length > 400 && (
                <button
                  className="text-xs text-primary mt-1 underline"
                  onClick={() => setShowMore((v) => !v)}
                >
                  {showMore ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {ingest.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ingest.media.map((m) => (
                <a
                  key={m.cloudinary_id}
                  href={m.cloudinary_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.cloudinary_url}
                    alt=""
                    className="h-20 w-20 object-cover rounded border"
                  />
                </a>
              ))}
            </div>
          )}

          {/* ── Platform picker ── */}
          {gen.kind === "idle" || gen.kind === "error" ? (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Generate for
              </p>
              <div className="flex gap-3">
                {(["linkedin", "x"] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platforms.includes(p)}
                      onChange={() => togglePlatform(p)}
                      className="rounded"
                    />
                    {p === "linkedin" ? "LinkedIn" : "X / Twitter"}
                  </label>
                ))}
              </div>
              {gen.kind === "error" && (
                <p className="text-sm text-destructive">{gen.message}</p>
              )}
              <button
                onClick={handleGenerate}
                disabled={platforms.length === 0}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Generate post →
              </button>
            </div>
          ) : null}

          {/* ── Generation loading ── */}
          {gen.kind === "loading" && (
            <div className="flex items-center gap-3 pt-2 border-t">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                {STAGE_LABELS[gen.stage] ?? "Generating…"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Generated variants ── */}
      {gen.kind === "success" && (
        <div className="space-y-4">
          <p className="text-sm font-medium">Generated drafts</p>
          {gen.variants.map((v) => (
            <div key={v.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {v.platform === "linkedin" ? "LinkedIn" : "X / Twitter"}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(v.body)}
                  className="text-xs text-primary underline"
                >
                  Copy
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{v.body}</p>
              <div className="flex gap-2 pt-1 border-t">
                <button
                  disabled
                  title="Coming in Phase 4"
                  className="px-3 py-1 rounded-md border text-xs disabled:opacity-40 cursor-not-allowed"
                >
                  Schedule
                </button>
                <button
                  disabled
                  title="Coming in Phase 4"
                  className="px-3 py-1 rounded-md border text-xs disabled:opacity-40 cursor-not-allowed"
                >
                  Publish now
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              setGen({ kind: "idle" });
            }}
            className="text-sm text-primary underline"
          >
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
pnpm --dir web typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Run all web tests**

```bash
pnpm --dir web test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add web/lib/supabase/browser.ts web/app/(app)/chat/page.tsx
git commit -m "feat: chat UI — generate flow with platform picker, Realtime stage updates, variants display"
```

---

## Task 10: Write the Phase 3 doc and update CLAUDE.md

**Files:**
- Modify: `docs/phases/PHASE_3_GENERATION.md`
- Modify: `CLAUDE.md`
- Modify: `docs/SESSION_NOTES.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Write PHASE_3_GENERATION.md**

Replace the empty `docs/phases/PHASE_3_GENERATION.md` with:

```markdown
# Phase 3 — Generation

The goal of Phase 3 is a working end-to-end AI generation pipeline: after a successful ingest, a user selects one or more platforms and clicks "Generate post". The worker runs Pass-1 (LLM summarises the source) and Pass-2 (LLM writes platform-specific posts using the brand system prompt), and the results appear as editable drafts in the chat UI.

If by the end of this phase a user can paste a URL, extract content, click Generate, and see LinkedIn and/or X drafts stored in the database — Phase 3 is done.

---

## Acceptance criteria

- [ ] Migration `0004_generation.sql` applies cleanly
- [ ] `pnpm --dir web gen:types` regenerates types including `content_items` and `post_variants`
- [ ] `POST /generate` on the worker returns a non-empty `summary` and `variants` given real extracted text
- [ ] Groq fallback: if `GROQ_API_KEY` is invalid/missing, Gemini is used instead
- [ ] `POST /api/posts` with a valid `ingestion_job_id` + `platforms` returns `content_item_id` and `variants`
- [ ] `content_items` row exists in Supabase with `summary` populated after a successful generate
- [ ] `post_variants` rows exist with `status = 'draft'`
- [ ] Chat UI: "Generate post" button enabled after extraction; platform checkboxes visible
- [ ] Chat UI: stage label updates during generation (analyzing / writing posts)
- [ ] Chat UI: variant text and Copy button visible after generation
- [ ] `pnpm --dir web typecheck` passes
- [ ] `pnpm --dir web test` passes
- [ ] `cd worker && uv run pytest` passes
```

- [ ] **Step 2: Bump CLAUDE.md current phase**

In `CLAUDE.md`, find the line:

```
**Phase 2 — Ingestion.** Phase 1 (Auth & Brand) is complete.
```

Replace with:

```
**Phase 3 — Generation.** Phase 2 (Ingestion) is complete. See `docs/phases/PHASE_2_INGESTION.md` for what was built.
```

- [ ] **Step 3: Append to DECISIONS.md**

Append:

```markdown
## 2026-04-23: Groq primary / Gemini fallback LLM strategy

**Decision:** The worker's `adapters/llm.py` tries Groq first and falls back to Gemini on any exception. Model config (`groq_model`, `gemini_model`) is in `Settings` so it can be swapped without code changes.

**Why:** Groq is faster and cheaper for Llama 3; Gemini is a reliable fallback with generous free tier. Having both in prod avoids a single point of failure for generation.

**Alternatives considered:** OpenAI (more expensive, no speed advantage), single provider (fragile).

**Trade-off:** We pay for two API keys and need to handle two different SDK interfaces.

**Reversibility:** Cheap — swap the adapter function, re-deploy.

---

## 2026-04-23: POST /api/posts is synchronous in Phase 3

**Decision:** The generation route waits for the worker to return before responding (same pattern as Phase 2 ingest). Supabase Realtime is used for stage-label updates in the UI, but the response body carries the final variants.

**Why:** Async fire-and-forget on Vercel Hobby has a 10s function timeout. Adding `@vercel/functions waitUntil` or a background queue introduces infra complexity not yet needed. Generation currently takes < 10s on Groq.

**Alternatives considered:** Vercel `waitUntil` (works on Pro, not Hobby), Inngest background jobs (adds a managed service).

**Trade-off:** If generation ever exceeds the Vercel timeout (10s Hobby / 60s Pro), we will need to move to async. This is noted for Phase 5.

**Reversibility:** Medium. Moving to async requires adding a job queue and changing the client polling model.
```

- [ ] **Step 4: Append to SESSION_NOTES.md**

Prepend a new entry at the **top** of `docs/SESSION_NOTES.md` (after the header):

```markdown
## 2026-04-23 — Phase 3 complete: AI generation pipeline

**What got built:**

- Migration `0004_generation.sql` — `content_items`, `post_variants` tables with RLS, indexes, `updated_at` trigger
- Worker LLM adapters: `worker/adapters/groq.py`, `worker/adapters/gemini.py`, `worker/adapters/llm.py` (Groq primary, Gemini fallback)
- Worker pipeline: `worker/pipeline/analyze.py` (Pass 1: source → summary), `worker/pipeline/generate.py` (Pass 2: summary → platform variants)
- Worker route: `worker/routes/generate.py` — `POST /generate`
- Web: `workerGenerate()` added to `worker-client.ts`
- Web db layer: `web/lib/db/posts.ts` — `createContentItem`, `updateContentItem`, `createPostVariants`, `getContentItemWithVariants`, `listContentItemsForJob`
- Web route: `web/app/api/posts/route.ts` — `POST /api/posts` with full auth + Zod + stage tracking
- Browser Supabase client: `web/lib/supabase/browser.ts`
- Chat UI: full generation flow — platform picker, Realtime stage labels, variant display, Copy button

**Decisions made:**

- Groq primary / Gemini fallback (see DECISIONS.md)
- Generation remains synchronous in Phase 3 (see DECISIONS.md)

**What's next (Phase 4 — Publishing):**

- X OAuth (start + callback routes, adapter)
- `publish_attempts` table
- `POST /api/posts/[id]/publish` (publish now)
- `POST /api/posts/[id]/schedule` (schedule)
- Cron: `POST /api/cron/publish-due`
- Enable "Publish now" and "Schedule" buttons in the UI

**Gotchas:**

- `getBrandConfig` must exist in `web/lib/db/brand.ts` — add it if missing (Phase 1 may not have exported it)
- Worker `.env` needs `GROQ_API_KEY` + `GEMINI_API_KEY` before local generation works
- Groq `llama-3.1-70b-versatile` context window is 32k tokens — extracted text is truncated to 8k chars in `analyze.py` to leave room for output
- Realtime `postgres_changes` requires the table to have replica identity set; Supabase enables this by default on new projects
```

- [ ] **Step 5: Run final checks**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
pnpm --dir web typecheck
pnpm --dir web test
```

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio/worker"
uv run pytest tests/ -v
```

Expected: all passing across both services.

- [ ] **Step 6: Final commit**

```bash
cd "c:/Users/abhishek jyotiba/OneDrive/Desktop/Socialio"
git add docs/phases/PHASE_3_GENERATION.md CLAUDE.md docs/DECISIONS.md docs/SESSION_NOTES.md
git commit -m "docs: Phase 3 doc, CLAUDE.md phase bump, decisions + session notes"
```

---

## Spec Coverage Check

| Requirement | Task |
|---|---|
| `content_items` + `post_variants` tables with RLS | Task 2 |
| Pass-1 analyze (LLM summary) | Task 5 |
| Pass-2 generate (platform variants) | Task 5 |
| Groq adapter + Gemini fallback | Task 4 |
| Worker `/generate` route | Task 6 |
| `workerGenerate()` typed client | Task 7 |
| `web/lib/db/posts.ts` | Task 7 |
| `POST /api/posts` web route | Task 8 |
| `ingestion_jobs.stage` advances through analyzing/generating/storing | Task 8 |
| Chat UI — platform picker + generate flow | Task 9 |
| Chat UI — Realtime stage labels | Task 9 |
| Chat UI — variant display with Copy button | Task 9 |
| Tests (worker pytest) | Tasks 4, 5 |
| Tests (web vitest) | Task 7 |
| Docs (DATA_MODEL, API_CONTRACTS, CLAUDE.md, SESSION_NOTES) | Tasks 2, 8, 10 |
| Phase branch + commit hygiene | Tasks 1–10 |
