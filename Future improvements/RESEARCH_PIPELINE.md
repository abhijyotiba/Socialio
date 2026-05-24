# Research & Generation Pipeline — Evolution Plan

**Status:** Living document. Level 1 shipped; Levels 2–3 planned, not started.
**Owner:** Product + eng
**Last updated:** 2026-05-24

---

## 1. The problem we're solving

The original generation flow forced a rigid sequence:

```
paste URL → wait for scrape/extraction → review extracted content → click "Generate"
```

Two real frictions came out of this:

1. **It's a multi-step chore.** The user has to paste, wait, then explicitly trigger generation — even when they already know exactly what they want.
2. **It throws away intent.** When a user pastes a link, they almost always *already have an angle* ("make this skeptical", "focus on the pricing implications"). The old flow had nowhere to put that, so the angle was lost.

It also couldn't handle two common cases at all:
- **Topic-only prompts** — "Write about Anthropic's new model release" (no URL to paste).
- **Time-bound / question prompts** — "What did Sam Altman say about AGI this week?"

The desired mental model: **the user types one thing — a URL, a URL with an angle, or just a topic — and we handle the rest.**

---

## 2. The three-level model

We deliberately split this into three levels so we can ship value incrementally and avoid over-building.

| Level | What it does | New dependencies | Latency | Status |
|---|---|---|---|---|
| **1 — Prompt-first input** | One input box. URL optional. Angle/topic captured in the same message. | None | Unchanged | ✅ Shipped |
| **2 — Search when no URL** | Topic prompts trigger a web search; system picks + scrapes sources, then generates with citations. | 1 search API | +15–30s on topic prompts | 🔜 Planned (next) |
| **3 — Research agent** | Multi-step tool-use loop: search → pick → scrape → re-search → cite. Multiple tools (web, YouTube, news, etc.). | Search + per-tool APIs | +45–75s worst case | 🔭 Deferred |

**Principle:** don't skip ahead. Ship Level 1, watch real prompts, then decide whether Level 2's search is worth the cost. Build Level 3 only if Level 2 proves users want deeper research.

---

## 3. Level 1 — Prompt-first input (SHIPPED)

**Commit:** `3c446d4` on branch `claude/review-multi-persona-arch-CwGpD` (PR #9).

### What it does

The chat input accepts a single message and routes on whether it contains a URL:

| Input | Behaviour |
|---|---|
| `https://site.com/article` | Extract → review card → generate (unchanged) |
| `https://site.com/article — make it skeptical` | Extract the URL; the rest becomes the **angle**, shown on the card and applied to every persona's post |
| `Why most AI startups will fold by 2027` | **No extraction step** — generate straight from the topic |

### How it was built

- **`parseInput()`** (chat) pulls the first URL out of free text; the remainder is the angle.
- **Worker `/generate`** gained an optional `user_angle`. Three prompt-building branches: `summary + angle`, `summary only` (legacy), `angle only` (topic). Summarize is skipped when there's no source text.
- **`/api/campaigns`** accepts `user_angle`, persists it on the campaign (migration `0019`), and threads it to the worker per persona. Generation now requires *either* source text *or* an angle.
- **Prompt-only guard:** a text job carrying an angle is treated as topic-only — `extracted_text` is blanked so the worker doesn't double-count a one-line prompt as "source material".
- **UI:** angle chip on the extraction card; angle shown on the campaign detail page; placeholder advertises all three modes.

### What Level 1 is NOT

Level 1 does **no research**. A bare topic prompt generates from the LLM's training knowledge — it does not look anything up. "What did OpenAI announce today" writes from what the model already knows, which may be stale or wrong. Closing that gap is Level 2.

---

## 4. Level 2 — Search when there's no URL (NEXT)

### Goal

When the user gives a topic with no URL, the system finds real sources, reads them, and generates grounded, current content with citations — instead of relying on stale model knowledge.

```
"Write about OpenAI's DevDay announcements"
    → search the web
    → LLM picks the 1–3 most relevant results
    → scrape those (existing Playwright pipeline)
    → generate with sources, cite them
```

### Search provider — decision needed

| Provider | Free tier | Notes |
|---|---|---|
| **Tavily** | 1,000 searches/mo | Built for LLM/RAG use; returns clean summaries. Easiest integration. **Recommended starting point.** |
| **Brave Search API** | 2,000 queries/mo | Raw results, cheap paid tier. More post-processing needed. |
| **SerpAPI** | Paid only (100 free trial) | Best quality, Google-backed. Pricey at scale. |

Recommendation: **start with Tavily** (LLM-shaped output, generous free tier), abstract it behind a worker adapter so swapping providers later is a one-file change.

### Flow / responsibilities

- **Worker** owns search + scraping (keep Next.js a thin orchestrator):
  - New endpoint `POST /research/search` → returns ranked results (title, url, snippet).
  - Reuse existing `/ingest` scraping for the chosen URLs.
  - New endpoint or pipeline step: "given query + N search results, pick the best 1–3" (one LLM call).
- **Next.js** `/api/campaigns` (or a new `/api/research` precursor):
  - When the job is prompt-only (no URL) AND Level 2 is enabled, call the worker's research path before generation.
  - Store which sources fed the generation.

### Data model additions (proposed)

```sql
-- A topic prompt can fan out to several searched + scraped sources.
CREATE TABLE research_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  title         TEXT,
  snippet       TEXT,
  used          BOOLEAN NOT NULL DEFAULT false,  -- was it actually scraped + fed to generation
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

(Final shape TBD — may attach to the campaign or to a dedicated `research_sessions` row if a prompt produces multiple searches.)

### Costs & trade-offs

- **LLM cost:** ~2–3× per topic-only generation (one extra call to rank sources, plus larger context with scraped material).
- **Latency:** topic prompts go from ~15s → ~30–45s. URL and URL+angle prompts are unaffected.
- **New failure modes:** search returns nothing, all results are paywalled/un-scrapeable, agent picks a bad source. Need graceful fallback ("couldn't find good sources — want me to write from general knowledge instead?").
- **Rate limits:** search APIs charge per query → cache search results (e.g. same query within 1h) and scraped pages (same URL within 24h).

### Task breakdown (rough)

| Task | Est. |
|---|---|
| Tavily adapter in worker (`adapters/search.py`) + `/research/search` endpoint | 0.5d |
| "Pick best sources" LLM step | 0.5d |
| Wire prompt-only flow → search → scrape → generate | 1d |
| `research_sources` migration + persistence + citation in output | 1d |
| Caching (search + scrape) | 0.5d |
| Empty/failed-search fallback UX | 0.5d |
| Tests (adapter mocked, source-pick logic, end-to-end happy + empty path) | 1d |
| **Total** | **~5 days** |

### Gate before starting

Watch Level 1 usage first. Specifically:
- How often do users type **topic-only** vs **URL-with-angle**? (If topic-only is rare, Level 2 is lower priority.)
- What do topic prompts actually look like? (Determines how much the search step matters.)

---

## 5. Level 3 — Research agent (DEFERRED)

A tool-use loop where the LLM decides what to do step by step:

```
search → pick → scrape → "not enough detail, search again" → cite
```

Tools: web search, URL scrape, YouTube transcript, news API, Reddit, Wikipedia. Output cites all sources; the user can inspect "what did the agent read?".

**Why deferred:**
- ~5–10× LLM cost per generation.
- 45–75s latency in the bad case.
- Hard to evaluate quality (vs. "search + scrape", which is easy to eyeball).
- Competes more directly with ChatGPT — needs to be clearly better, and our differentiator (versioned brand voice + persona-aware generation) is the thing to lean on.

**Build it only if** Level 2 ships and users repeatedly ask for deeper, multi-source research ("find me the best counter-argument", "compare these three takes").

### Architecture notes for whenever we build it

- Keep adding tools as **worker endpoints** (`/research/search`, `/research/youtube`, …). Next.js stays the orchestrator.
- Don't conflate "one ingestion = one URL" with a multi-step research session. Introduce `research_sessions` + `research_steps`.
- Cache aggressively (search + scrape).
- Attribute sources to variants (`variant_sources`).

---

## 6. Product framing to keep in mind

The current product is **"adapt content for social."** Levels 2–3 shift it toward **"create content from intent,"** which overlaps with ChatGPT/Jasper/Copy.ai. Our wedge in that space is the **versioned brand voice + persona-aware generation** — we already know the user's voice and can fan out across personas. Lean on that hard in the UX ("we already write in your voice") rather than competing on raw generation quality.

---

## 7. Related deferred work (cross-references)

These came up in the same planning conversations and are tracked in `docs/BACKLOG.md`:

- **Scheduling / cron on free tier.** Vercel Hobby crons run only once/day, so scheduled auto-publishing is effectively broken. Decided to stay on free for the first 5–10 workspaces; plug the gap later via a free GitHub Actions cron pinging the publish endpoint every ~5 min, or upgrade to Vercel Pro. Everything else works on free.
- **Python backend migration.** A proposal to move publishing/scheduling/orchestration into a third (Python) service was reviewed and **deferred** — most of its motivating problems are Vercel-free-tier limits solvable with Pro ($20/mo) or a managed queue (Inngest/QStash), and it would duplicate the LinkedIn/X adapters across two languages. Revisit at ~100 paying workspaces or when image generation needs real async job infra.
- **Token refresh job.** LinkedIn tokens expire in 60 days; X has no refresh token (2h expiry). No proactive refresh exists yet. Build as a daily cron (works on Hobby) regardless of the backend decision.
- **Error tracking → Sentry.** A lightweight `error_events` table + `logError()` is in place (migration `0018`). Swapping in `@sentry/nextjs` is the natural follow-up; needs explicit approval to add the runtime dependency.
- **Per-persona posting schedules.** `posting_schedules.persona_id` exists, but the schedule UI + `/api/schedule-slots` are still workspace-scoped. Make them persona-aware and restore the per-persona schedule link.
- **Image generation.** When built, add `/generate/image` to the worker. This is the feature most likely to justify the deferred Python backend (async jobs, progress tracking).

---

## 8. Open decisions before Level 2

1. **Search provider:** Tavily (recommended) vs Brave vs SerpAPI.
2. **Where the research step lives:** inline in `/api/campaigns`, or a new `/api/research` precursor that produces an ingestion-job-like artifact the campaign then consumes.
3. **Citation surface:** do generated posts visibly cite sources, or are sources only shown in the review UI (not in the published post)?
4. **Fallback behaviour** when search finds nothing: silently fall back to general-knowledge generation, or ask the user?
