# Phase 7 — Voice & Refinement

The goal of Phase 7 is to make AI-generated posts *sound like the user*, not like generic LinkedIn boilerplate. Phase 6 finishes V1's surface area (metrics, dashboard, Google OAuth); Phase 7 starts addressing the core product critique: **one-shot generation with a hand-written brand prompt produces generic output, and that's the bar competitors will be judged against.**

If by the end of this phase a new user can paste 5–10 of their own social posts during onboarding and immediately see drafts that recognisably match their voice — and an existing user can iterate on a generated draft inline ("make it shorter", "more personal", "change the hook") without re-running the whole pipeline — Phase 7 is done.

---

## Goal

After this phase, a user can:

1. During onboarding, choose between "Paste your recent posts so we can learn your voice" (recommended) and "I'll write the system prompt myself" (existing path).
2. Paste 3–15 of their own LinkedIn/X posts and get back a structured **voice profile** plus an auto-generated system prompt that reflects their actual writing patterns.
3. View, edit, and refresh the voice profile from `Settings → Brand` at any time. Refreshing creates a new `prompt_versions` row — the old prompt is preserved.
4. Inside any generated `post_variant`, click a quick-action ("Shorter", "More personal", "Change hook", "Add CTA") or type a free-text instruction to regenerate the body in-place. The original draft is preserved as a previous version.

---

## Scope — what IS in this phase

- **Voice profile from pasted samples:**
  - New `voice_profile JSONB` column on `brand_configs` and a `source` column on `prompt_versions`.
  - New worker module `worker/pipeline/voice_profile.py` that analyzes samples → structured JSON profile, and renders profile → system prompt.
  - New worker route `POST /worker/voice/analyze` (HMAC-signed, like every other worker route).
  - New web route `POST /api/brand/voice-profile` that orchestrates the analyze call, writes the profile, and inserts a new `prompt_versions` row.
  - Onboarding `BrandStep` refactor: voice-from-samples flow with a fallback to the existing manual prompt.
  - Settings → Brand: "Refresh voice profile" panel.
- **Inline regeneration with instructions:**
  - New web route `POST /api/posts/:variantId/regenerate` taking `{ instruction: string }`.
  - New worker route `POST /worker/generate/regenerate` taking `{ original_summary, current_body, platform, brand_system_prompt, instruction }`.
  - New `regeneration_history` table (or column on `post_variants`) preserving previous bodies so users can revert.
  - Variant card UI: quick-action chips (Shorter / Longer / More personal / Less corporate / Change hook / Add CTA / Add question) plus a free-text `instruction` input.
- **Tests:**
  - Worker fixture-based test of `analyze_samples` against 3 hand-curated sample sets — assert the output matches the Pydantic schema and the inferred fields (length bucket, register) are within tolerance.
  - Web tests for `/api/brand/voice-profile` and `/api/posts/:id/regenerate` with a mocked worker adapter.

## Scope — what is NOT in this phase

- **Edit-diff feedback loop.** Storing the diff between AI draft and final published body, then folding patterns back into the profile. Compelling but premature — defer until we have signal on whether voice profiles meaningfully change perceived quality. Tracked in `BACKLOG.md`.
- **Performance-based learning.** Using `post_metrics` (Phase 6) to bias generation toward styles that performed well. Defer to Phase 8.
- **Scraping the user's LinkedIn for them.** Forbidden by `CLAUDE.md §9` and `docs/DECISIONS.md`. Users paste their own posts. We do not work around this.
- **Scraping the user's own website / blog as a voice signal.** Legally fine (it's their site) but not in this phase — adds scope and the paste flow must work first.
- **Batch generation ("5 posts about topic X").** Defer to V2; pushes the product back toward "set it and forget it" automation, which the product critique flagged as the riskier positioning.
- **Thread generation, LinkedIn long-form articles.** V2.

---

## Data model

### Migration: `supabase/migrations/0012_voice_profile.sql`

```sql
ALTER TABLE public.brand_configs
  ADD COLUMN voice_profile JSONB,
  ADD COLUMN voice_profile_updated_at TIMESTAMPTZ;

ALTER TABLE public.prompt_versions
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'voice_profile', 'voice_profile_edited'));
```

**Why a column on `brand_configs` instead of a new table:** there is exactly one current voice profile per workspace. Versioning of the *prompt that was rendered from it* is already handled by `prompt_versions`. A separate `voice_profiles` table would duplicate the cardinality and add a join for no benefit.

**Why JSONB:** the schema is going to evolve. We want to add fields (`avoid_phrases`, `signature_phrases`, etc.) without migrating. The Pydantic model in the worker is the schema-of-record for shape; the DB just stores the blob.

**Why a `source` column on `prompt_versions`:** so we can show users in Settings: "v3 (generated from voice profile · 2 weeks ago)" vs. "v4 (you edited it)". Also lets us re-render `voice_profile`-source rows from a newer prompt template without losing user edits to `manual` rows.

### Migration: `supabase/migrations/0013_post_variant_revisions.sql`

Two viable shapes — pick one during implementation, do not do both:

**Option A (recommended): new table `post_variant_revisions`.**

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `post_variant_id` | `UUID` NOT NULL | FK `post_variants(id)`, cascade delete |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `revision_number` | `INT` NOT NULL | Monotonically increasing per variant |
| `body` | `TEXT` NOT NULL | Snapshot of `post_variants.body` at this revision |
| `instruction` | `TEXT` | Null for the initial generation; the user's instruction otherwise |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| — | UNIQUE (`post_variant_id`, `revision_number`) | |

RLS: workspace members select/insert. Append-only; no update/delete policies.

**Option B: `regeneration_count INT` column on `post_variants` plus a single `previous_body TEXT`.** Cheaper, but only supports one-step undo and loses history. Reject unless we have a strong reason.

Pick A. Index: `idx_post_variant_revisions_variant` on `post_variant_id`.

---

## Voice profile JSON shape (worker-side schema-of-record)

```python
class VoiceProfile(BaseModel):
    schema_version: Literal[1]
    samples_count: int
    platform_mix: dict[str, int]                  # {"linkedin": 5, "x": 2}
    length: LengthProfile                          # avg_words, p90_words, tends ("short"|"medium"|"long")
    structure: StructureProfile                    # uses_line_breaks, uses_bullets, uses_numbered_lists, paragraph_count_avg
    tone: ToneProfile                              # register, uses_first_person, personal_anecdotes, emoji_use, emoji_typical
    openers: PatternProfile                        # patterns: list[str], examples: list[str]
    closers: ClosersProfile                        # patterns, uses_hashtags
    topics: list[str]                              # 1–5 topic clusters
    avoid: list[str]                               # phrases / patterns explicitly absent
```

Defined in `worker/pipeline/voice_profile.py` as Pydantic models so a malformed LLM response fails loudly rather than writing garbage to the DB.

---

## Files to modify / create

```
supabase/
└── migrations/
    ├── 0012_voice_profile.sql          # NEW
    └── 0013_post_variant_revisions.sql # NEW

worker/
├── pipeline/
│   ├── voice_profile.py                # NEW — analyze_samples, render_system_prompt
│   └── regenerate.py                   # NEW — regenerate_variant
├── routes/
│   ├── voice.py                        # NEW — POST /worker/voice/analyze
│   └── generate.py                     # MODIFY — add POST /worker/generate/regenerate
└── tests/
    ├── test_voice_profile.py           # NEW
    └── test_regenerate.py              # NEW

web/
├── app/
│   ├── api/
│   │   ├── brand/voice-profile/route.ts          # NEW
│   │   └── posts/[variantId]/regenerate/route.ts # NEW
│   └── (app)/
│       ├── onboarding/_components/BrandStep.tsx          # MODIFY — fork into voice-from-samples vs manual
│       ├── onboarding/_components/VoiceSamplesStep.tsx   # NEW — paste-N-samples UI
│       └── settings/brand/                                # MODIFY — add "Refresh voice profile" panel
├── lib/
│   ├── db/
│   │   └── brand.ts                              # MODIFY — addVoiceProfile, getVoiceProfile
│   └── adapters/
│       └── worker.ts                             # MODIFY — analyzeVoiceSamples, regenerateVariant
└── components/
    └── posts/
        └── VariantCard.tsx                       # MODIFY — quick-action chips + instruction input

docs/
├── DATA_MODEL.md                                  # UPDATE — add Phase 7 section
├── DECISIONS.md                                   # APPEND — entry for "voice profile via paste, not scrape"
└── phases/PHASE_7_VOICE.md                        # this file
```

---

## Steps

1. **Validate the analysis prompt with throwaway samples.** Before writing any code, hand-craft 3 sets of 5–7 sample posts representing distinct voices (e.g. punchy founder, formal exec, witty marketer). Run the candidate analysis prompt against each set in a notebook. Iterate until the JSON output is stable across runs (low temperature) and the `tone.register` / `length.tends` / `openers.patterns` fields visibly differ across the three sets. **If we cannot get stable, distinguishable output, stop here and reconsider the design.** This is the load-bearing assumption.
2. **Migration 0012 + types.** Add `voice_profile` and `source` columns. Run `pnpm gen:types`. Update `docs/DATA_MODEL.md`.
3. **Worker `voice_profile.py`.** Pydantic models, `analyze_samples()`, `render_system_prompt()`. Pure-Python `render_system_prompt` — no LLM call, deterministic, fully unit-tested.
4. **Worker `/voice/analyze` route.** HMAC-signed. Tested with the fixture sample sets from step 1.
5. **Web `/api/brand/voice-profile` route + `lib/db/brand.ts` helpers.** Validates with Zod (3–15 samples, 20–3000 chars each, total ≤ 30 KB), calls worker, writes profile, inserts new `prompt_versions` row with `source='voice_profile'`, updates `current_prompt_version_id`.
6. **Onboarding flow.** New `VoiceSamplesStep` component. Refactor `BrandStep` to fork on "Paste samples" vs "Write prompt manually". Show the inferred profile as friendly prose ("You write medium-length posts, often opening with a personal story…") and the rendered system prompt below, with an "Edit" affordance.
7. **Settings → Brand panel.** "Refresh voice profile" — same endpoint, different entry point. Show `voice_profile_updated_at` and the source label on each `prompt_versions` row.
8. **Migration 0013 + types** for `post_variant_revisions`.
9. **Worker `regenerate.py` + `/generate/regenerate` route.** Takes original summary, current body, instruction, brand prompt, platform. Returns new body.
10. **Web `/api/posts/:variantId/regenerate` route.** Validates instruction length, fetches the current variant + brand prompt, calls worker, snapshots the old body into `post_variant_revisions`, updates `post_variants.body`.
11. **VariantCard UI.** Quick-action chips dispatch the same endpoint with a canned `instruction`. Free-text input for custom instructions. Show "Reverted from v2" affordance pointing back to revisions.
12. **DECISIONS.md entry.** Document the "paste, never scrape" choice and why we stored the profile as JSONB on `brand_configs` rather than a new table.

---

## Acceptance criteria

A new user signs up, picks "Paste recent posts", pastes 5 of their LinkedIn posts, clicks Analyze, sees a profile summary that visibly differs from another test user's profile, accepts it, and proceeds to the dashboard. Their first generated post on a real URL is recognisably closer to their pasted samples than a control generation made with the default prompt.

An existing user opens a generated variant, clicks "Shorter", and the body shrinks while staying on-topic. They click "Revert" and the previous body returns. They type "add a stat about adoption" into the free-text box, hit regenerate, and the new body includes a plausible (or hallucinated — see open questions) stat.

`docs/DATA_MODEL.md` reflects the two new migrations. `docs/DECISIONS.md` has an entry. All worker tests and web tests pass without a live Supabase connection.

---

## Open questions to resolve before merging

1. **Sample storage.** Do we keep the raw pasted samples in the DB (in a new `voice_samples` table), keep only first-100-char excerpts for debugging, or discard them entirely after analysis? Default to **discard** unless there's a debugging need — minimises data we hold on behalf of users and reduces breach blast radius.
2. **Re-analysis cadence.** Never automatic, only on explicit "Refresh"? Or auto-suggest a refresh after 90 days? Default to **never auto** — surprise prompt changes are a worse failure mode than a slightly stale profile.
3. **Hallucinated facts in regeneration.** "Add a stat about adoption" will produce a fabricated number. Do we (a) refuse instructions that look fact-injecting, (b) warn the user that regenerated content may contain unverified claims, or (c) accept it as the user's responsibility? Probably (b) — a one-line caveat below the regenerate button.
4. **Profile preview UX.** Show the full JSON to power users in a "View raw" disclosure, or only the friendly summary? Default to **friendly summary by default, raw behind a toggle** — power users will want to debug, casual users will be intimidated.
5. **Mandatory vs skippable in onboarding.** Required-with-skip recommended. Many users will bail mid-paste; the manual prompt path is a real fallback.
6. **Token budget for analysis.** 15 samples × 3000 chars ≈ 45 KB ≈ 12k tokens. Comfortably inside Groq's window but not free. Set a per-workspace daily limit (e.g. 5 analyses / day) to prevent accidental loops while we tune.

---

*Created at the close of Phase 6 planning, before Phase 6 implementation has finished. This phase is gated on Phase 6 acceptance — do not start Phase 7 work while Phase 6 is in flight.*
