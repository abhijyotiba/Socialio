# Phase 3 — Generation

The goal of Phase 3 is a working end-to-end AI generation pipeline: after a successful ingest, a user selects one or more platforms and clicks "Generate post". The worker runs Pass-1 (LLM summarises the source) and Pass-2 (LLM writes platform-specific posts using the brand system prompt), and the results appear as editable drafts in the chat UI.

If by the end of this phase a user can paste a URL, extract content, click Generate, and see LinkedIn and/or X drafts stored in the database — Phase 3 is done.

---

## What was built

- Migration `0004_generation.sql` — `content_items`, `post_variants` tables with RLS, indexes, `updated_at` trigger
- Migration `0005_content_items_indexes.sql` — additional indexes for `content_items`
- Worker LLM adapters: `worker/adapters/groq.py`, `worker/adapters/gemini.py`, `worker/adapters/llm.py` (Groq primary, Gemini fallback)
- Worker pipeline: `worker/pipeline/analyze.py` (Pass 1: source → summary), `worker/pipeline/generate.py` (Pass 2: summary → platform variants)
- Worker route: `worker/routes/generate.py` — `POST /generate`
- Web: `workerGenerate()` added to `worker-client.ts`
- Web db layer: `web/lib/db/posts.ts` — `createContentItem`, `updateContentItem`, `createPostVariants`, `getContentItemWithVariants`, `listContentItemsForJob`
- Web db layer: `web/lib/db/brand.ts` — `getBrandConfig`
- Web route: `web/app/api/posts/route.ts` — `POST /api/posts`
- Browser Supabase client: `web/lib/supabase/browser.ts`
- Chat UI: full generation flow — platform picker, Realtime stage labels, variant display, Copy button

---

## Acceptance criteria

- [x] Migration `0004_generation.sql` applies cleanly
- [x] Migration `0005_content_items_indexes.sql` applies cleanly
- [x] `pnpm --dir web gen:types` regenerates types including `content_items` and `post_variants`
- [x] `POST /generate` on the worker returns `summary` + `variants` given real extracted text
- [x] Groq fallback: if Groq fails, Gemini is used
- [x] `POST /api/posts` with valid `ingestion_job_id` + `platforms` returns `content_item_id` and `variants`
- [x] `content_items` row exists in Supabase with `summary` populated after generate
- [x] `post_variants` rows exist with `status = 'draft'`
- [x] Chat UI: "Generate post" button enabled after extraction
- [x] Chat UI: platform checkboxes visible; stage label updates during generation
- [x] Chat UI: variant text + Copy button visible after generation
- [x] `pnpm --dir web typecheck` passes
- [x] `pnpm --dir web test` passes (21/21)
- [x] `cd worker && uv run pytest` passes (28/28)

---

## Known issues / backlog

- `google-generativeai` SDK is deprecated (EOL). Migrate to `google-genai` before production launch. See `docs/BACKLOG.md`.
