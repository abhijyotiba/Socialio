# Session Notes

Append-only handoff between Claude Code sessions. **Newest entry at the top.**

At the end of every session, add a new entry with:

- Date
- What got built
- What's left in the current phase
- Decisions made (also log in `DECISIONS.md` if architectural)
- Gotchas hit or pitfalls to watch for
- Exact next-step command or first action for the next session

---

## 2026-05-24 — Backend migration to Python, slice 3b: persona mutations

Branch: `claude/vigilant-galileo-7aCpn` (PR #13)

### What got built

Moved the persona **mutation** routes (the ones with logic) into the worker; reads
stay in Next.js.

- `POST /api/personas` → worker (soft cap 10, hard cap 50, slug generation).
- `PATCH /api/personas/[id]` and `DELETE /api/personas/[id]` → worker (delete guards:
  default persona, pending campaigns → 409).
- Worker: `worker/routes/personas.py` + new `worker/db/personas.py` helpers
  (`count_personas`, `generate_persona_slug`, `create_persona`, `update_persona`,
  `delete_persona`). Guard violations raise `ValueError`, mapped to 400/409 in the route.
- **Kept in Next.js:** `GET /api/personas` (list) and `GET /api/personas/[id]` (persona +
  brand summary + connections) — pure reads.
- **Removed dead web code:** `createPersona`, `updatePersona`, `deletePersona`,
  `generatePersonaSlug` (personas.ts) and the obsolete `lib/db/__tests__/personas.test.ts`
  (its deletePersona-guard coverage now lives in worker `test_personas_route.py`). Kept
  `getPersona`, `getPersonasForWorkspace`, `getDefaultPersona` (still widely used).

### Tests

- Worker: 101 pass. New `test_personas_route.py` (create, invalid color → 400, soft-cap →
  400, hard-cap ValueError → 400, patch, patch-404, delete, delete-guard → 409).
- Web: 76 pass (was 78; -2 from the removed deletePersona test), typecheck + lint clean.

### Next step

Remaining CRUD: `/api/brand/*`, `/api/connections`, `/api/profile`, `/api/metrics`,
`/api/queue`, plus the deferred campaign + persona GET reads. Then publishing + cron last.

## 2026-05-24 — Backend migration to Python, slice 3a: campaign management

Branch: `claude/vigilant-galileo-7aCpn` (PR #13)

### What got built

Moved the campaign **mutation** routes (the approval state machine) into the worker,
completing worker ownership of campaign writes. All are thin proxies on the web side:

- `DELETE /api/campaigns/[id]` → worker (ownership + live-variant guard).
- `POST /api/campaigns/[id]/approve` → worker (approve all or a `persona_ids` subset:
  mark approved, flip variants to `scheduled`, audit event, roll campaign to `approved`
  once every persona is resolved).
- `POST /api/campaigns/[id]/cancel-scheduled` → worker.
- `POST /api/campaigns/[id]/persona/[persona_id]/approve` and `.../reject` → worker.

Worker additions in `worker/db/campaigns.py` (`get_campaign`, `get_campaign_personas`,
`update_campaign_persona_approval`, `get_variants_for_campaign_persona`,
`set_post_variants_status`, `has_live_variants`, `delete_campaign`,
`cancel_scheduled_variants_for_campaign`) and the handlers in `worker/routes/campaigns.py`.

- Added a generic `workerFetch(path, {method, accessToken, json?})` helper to
  `web/lib/worker-client.ts` for signed + JWT-authed proxying (empty body → signature
  over "").
- **Still in Next.js (pure reads, complex nested shape — deferred):** `GET /api/campaigns`
  (list) and `GET /api/campaigns/[id]` (detail, `getCampaignWithPersonas`).
- **Removed dead web db code:** `updateCampaign`, `hasLiveVariants`, `deleteCampaign`,
  `cancelScheduledVariantsForCampaign`, `updateCampaignPersonaApproval`,
  `getVariantsForCampaignPersona` (campaigns.ts), and the whole `lib/db/audit-events.ts`
  (`insertAuditEvent` was its last user). Kept `getCampaignWithPersonas`,
  `countRecentCampaigns`, `listCampaignsForWorkspace` (still used by the GET routes).

### Tests

- Worker: 93 pass. New `test_campaign_actions.py` (approve all → schedules + marks
  approved; approve subset leaves pending; 404; persona approve/reject; cancel; delete
  ok; delete blocked by live variants).
- Web: 78 pass, typecheck + lint clean on changed files.

### Gotchas

- `approve` reads the raw body and tolerates an empty/absent one (approve-all), matching
  the old Zod `.catch(() => ({}))`. The web proxy always forwards `json: payload ?? {}`.
- Approval sets variant status to `scheduled` WITHOUT a `scheduled_at` (unchanged from the
  old behavior) — scheduling a time is a separate action.

### Next step

Remaining CRUD: `/api/personas*`, `/api/brand/*`, `/api/connections`, `/api/profile`,
`/api/metrics`, `/api/queue`, plus the two deferred campaign GET reads. Then publishing
+ cron last (Vault service-role exception + scheduler choice).

## 2026-05-24 — Backend migration to Python, slice 2: generation (campaigns + regenerate)

Branch: `claude/vigilant-galileo-7aCpn`

### What got built

Second migration slice (same proxy + RLS-via-JWT pattern as ingestion). Moved the
**generation** endpoints into the worker:

- **`POST /api/campaigns`** → worker `POST /campaigns` (`worker/routes/campaigns.py`).
  The worker now owns the full orchestration: rate-limit, validation, job/persona/
  brand/connection loads, campaign + campaign_personas creation, per-persona LLM
  generation (in parallel, 15s cap each), content_items/post_variants/
  campaign_persona_variants writes, partial-failure status
  (`failed` / `generation_partial` / `pending_approval`), and the `campaign.created`
  audit event. The LLM pipeline is called **in-process** — no more HTTP self-hop.
- **`POST /api/posts/[id]/regenerate`** → worker `POST /posts/{id}/regenerate`
  (`worker/routes/posts.py`): brand load (persona or workspace-default fallback),
  pre-regeneration revision snapshot, LLM regenerate, body update, post-regeneration
  snapshot, returns `{ body, revision_number }`.
- **New worker db modules:** `personas.py`, `brand_configs.py`, `social_connections.py`,
  `posts.py`, `campaigns.py`, `audit_events.py`, `post_variant_revisions.py`.
- **Removed dead code:** worker `routes/generate.py` (both endpoints replaced;
  `pipeline/` functions retained + still tested). Web `lib/worker-client.ts` lost
  `workerGenerate`/`workerRegenerate`/related types, gained `workerCampaigns` +
  `workerRegeneratePost`. Deleted fully-unused web db fns: `lib/db/ingestion.ts`
  (whole file — `getIngestionJob` was its last user), `createCampaign`/
  `createCampaignPersonas`/`createCampaignPersonaVariants` (campaigns.ts),
  `createContentItem`/`createPostVariants` (posts.ts).
- Web `GET /api/campaigns` (list) stays a Next.js handler — pure read, moves with
  the CRUD slice.

### Tests

- Worker: 84 pass. New `test_campaigns_route.py` (happy path, rate limit, job-not-ready,
  invalid persona, missing brand, all-fail→502, partial success) and
  `test_regenerate_route.py` (happy path, blank instruction, 404, non-editable status,
  missing brand, pipeline-failure→502). DB + LLM mocked, no live Supabase.
- Web: 78 pass, typecheck clean, lint clean on changed files.

### Gotchas

- The all-personas-failed case returns a **flat** `{ error, campaign_id }` at 502 via a
  direct `JSONResponse` — the global HTTPException handler wraps `detail` in `{error}`,
  which would double-nest a dict detail.
- `_generate_for_persona` is pure (no DB) so it's safe to `asyncio.gather`; DB writes
  happen sequentially afterward, mirroring the old web `Promise.allSettled` + sequential
  write loop.
- `maybe_single()` is used for single-or-none reads (returns `data=None` on 0 rows)
  instead of `single()` which raises.
- Kept shared web db fns still used by non-migrated routes (publish, approve/reject,
  CRUD): `updateCampaign`, `getPostVariant`, `updatePostVariant`, `getBrandConfigForPersona`,
  `getConnectionsForPersona`, `getPersona`, `insertAuditEvent`, `snapshotVariantBody`, etc.

### Next step

Next per the plan: **Posts CRUD** slice (`/api/posts*`, `/api/personas`, `/api/brand/*`,
`/api/connections`, `/api/profile`, `/api/metrics`, `/api/queue`, plus the campaign
management routes: GET list, detail, approve/reject/cancel) — mostly straight db-layer
ports. Publishing + cron remain last (Vault service-role exception + scheduler choice).

## 2026-05-24 — Backend migration to Python, pilot slice: ingestion

Branch: `claude/vigilant-galileo-7aCpn`

### What got built

Established the pattern for incrementally moving backend logic from Next.js into
the Python worker, preserving Supabase RLS by forwarding the user's JWT (see
`DECISIONS.md`, 2026-05-24). Migrated the **ingestion** slice end-to-end:

- **Worker auth (`worker/auth.py`):** added `verify_user()` — validates the
  forwarded Supabase JWT (JWKS/RS256 for asymmetric projects, `SUPABASE_JWT_SECRET`
  for legacy HS256). HMAC verification still runs too (defense-in-depth).
- **Worker DB layer (`worker/db/`):** new `client.py` (RLS-scoped `supabase-py`
  client via anon key + user JWT), `workspaces.py`, `ingestion.py`, `media_assets.py`.
  Mirrors `web/lib/db/`.
- **Worker `routes/ingest.py`:** now owns the full flow — auth, validation,
  LinkedIn guard, rate-limiting (2/min, 50/day), job creation, scrape/extract/upload,
  and DB writes. Added `GET /ingest/{job_id}` for polling.
- **Error shape (`worker/main.py`):** exception handlers normalize all errors to
  `{ "error": ... }` so the frontend's `data.error` contract holds.
- **Web side:** `app/api/ingest/route.ts` and `app/api/ingest/[job_id]/route.ts`
  are now thin proxies (auth gate + forward JWT + pass through status/body).
  `lib/worker-client.ts` gained `workerGetIngestion` and `workerIngest` now forwards
  the access token. Removed the now-dead `createIngestionJob`, `updateIngestionJob`,
  `countRecentJobs` (ingestion.ts) and `createMediaAssets` (media-assets.ts).
- **Deps:** added `supabase>=2.0`, `pyjwt[crypto]>=2.8` to `worker/pyproject.toml`.
  Added `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` to `.env.example`.

### Tests

- Worker: 71 pass (`uv run pytest`). New `test_auth_jwt.py` (JWT verify cases) and
  `test_ingest_route.py` (validation, LinkedIn guard, rate limit, text passthrough,
  URL happy-path with mocked scrape/DB — no live Supabase).
- Web: 78 pass, typecheck clean, lint clean on changed files. (Two pre-existing
  lint errors remain in `CampaignDetail.tsx` + a clock component — untouched, not ours.)

### Gotchas

- The frontend uses Supabase **Realtime** on `ingestion_jobs` (chat page) and does
  **not** poll `GET /api/ingest/{job_id}`. Worker writes under the user JWT still
  fire Realtime correctly. The synchronous POST must keep returning the extracted
  result inline (UI expects `job_id` + title/text/media in one response).
- The proxy uses `getSession()` (not `getUser()`) to grab the access token; the
  worker re-validates the JWT, so this is safe.
- `worker/tests/conftest.py` now stubs `SUPABASE_URL`/`SUPABASE_ANON_KEY` (required
  settings) — any new worker test needing config relies on these.

### Next step

Next slice per the plan: **generation / campaigns** (`/api/campaigns*`,
`/api/posts/[id]/regenerate`) — the worker already does the LLM work; move the
orchestration + `content_items`/`post_variants` writes using the same proxy + RLS
pattern. Publishing and cron are deferred to last (Vault + scheduler).
Verify the pilot live first: run `pnpm --dir web dev` + `cd worker && uv run fastapi dev`,
paste a URL in chat, confirm extraction works unchanged.

## 2026-05-16 — Phase V2.2: Multi-Persona Redesign (Round 2)

Branch: `claude/review-multi-persona-arch-CwGpD`

### What got built

**Round 1 (`019444d`) — surgical fixes**
- `/api/posts/[id]/publish` now uses `getSocialConnectionForPersona` when
  `variant.persona_id` is set, falling back to the workspace-default
  connection only for pre-persona variants.
- `/api/posts/[id]/regenerate` same treatment — persona-scoped brand fetch.
- Both OAuth callbacks (linkedin, x) validate the persona id extracted from
  signed state matches a UUID format before hitting the DB.
- Cron zombie-campaign cleanup emits a `campaign.zombie_timeout` audit event
  per failed campaign.

**Design doc (`ff72d48`)**
- `docs/phases/PHASE_V2_2_MULTIPERSONA_REDESIGN.md` — target architecture,
  file-by-file plan, data-model additions, migration plan A→E, acceptance
  criteria, decisions locked.

**Step A (`c06ba40`) — foundation modules + legacy quarantine**
- `lib/auth/persona-guard.ts` — `assertPersonaInWorkspace` with typed
  `PersonaGuardError` (NOT_FOUND / WORKSPACE_MISMATCH).
- `lib/policy/rate-limits.ts` — `canGenerateCampaign` and
  `consumePublishBudget` policy decisions.
- `lib/generation/context.ts` — `buildGenerationContext` bundles persona
  + brand + connected platforms + `prompt_version_id` snapshot.
- `lib/db/_legacy/{brand-configs,social-connections}.ts` — workspace-scoped
  helpers quarantined with `@deprecated`. Original files re-export so
  callers don't break.
- ESLint `no-restricted-imports` rule, initially `warn`.

**Step B (`ef556d1`) — caller migration + legacy POST deleted**
- 10 caller files moved to persona-scoped helpers.
- `POST /api/posts` deleted; chat page now always calls `/api/campaigns`.
- 3 fallback callers (cron/publish-due, posts/[id]/publish,
  posts/[id]/regenerate) import directly from `_legacy/` with a per-line
  `eslint-disable-next-line` and a comment explaining the legitimate
  pre-persona-variant fallback.
- Latent bug fixed: `setVoiceProfile(workspaceId)` updated EVERY persona's
  brand_configs row. New `setVoiceProfileForPersona(personaId)` writes to
  the intended persona only.

**Step C (`38d137f`) — UI surfaces**
- Campaign approval inbox: `/campaigns` (list with status pills and
  pending counts) and `/campaigns/[id]` (per-persona cards, variant
  bodies, approve/reject, Realtime subscription).
- Sidebar entry for Campaigns between Chat and Queue.
- `GET /api/campaigns` returns the workspace list with persona +
  pending counts.
- Latent bug fixed: `BrandSettingsForm` accepted `personaId` but didn't
  pass it on GET, so every per-persona voice page silently displayed the
  default persona's data. `GET /api/brand/config?persona_id=` accepts the
  query param now (guarded by `assertPersonaInWorkspace`), and
  `VoiceSamplesPanel` forwards `personaId` to `/api/brand/voice-profile`.
- `/settings/brand` and `/settings/connections` are now redirects to the
  default persona's per-persona pages.

**Step D — data-model migrations + drift guard**
- `0015_campaigns_error_and_prompt_snapshot.sql` — `failure_reason` and
  `failure_code` on `campaigns`; `prompt_version_id` snapshot on
  `campaign_persona_variants` (with partial index).
- `0016_platform_limits_table.sql` — single source of truth for daily
  caps. `claim_due_variants` RPC refactored to JOIN the table.
- `lib/db/types.ts` updated by hand to reflect the schema additions
  (no `supabase gen types` run in this environment).
- Cron zombie cleanup writes `failure_code='GENERATION_TIMEOUT'`.
- Campaign route writes `failure_code='ALL_PERSONAS_FAILED'` when every
  persona fails, and snapshots `prompt_version_id` on each variant.
- Campaign detail page surfaces `failure_reason` in a red banner.
- New test `tests/constants.platform-limits.test.ts` parses the migration
  seed and asserts it matches `PLATFORM_DAILY_LIMITS`.

**Step E — lockdown**
- ESLint `no-restricted-imports` flipped from `warn` to `error`.

### Test/lint/typecheck

74/74 tests pass. Typecheck clean. Lint baseline unchanged at 17 (6
pre-existing React Compiler errors, 11 pre-existing unused-vars). Zero
new lint issues from any step.

### Decisions made

Recorded in the design doc §10 (now locked):
1. `POST /api/posts` deleted outright. Chat UI always calls `/api/campaigns`.
2. `/settings/connections` redirects to the default persona's connections.
3. Approval is per-persona only (no per-platform-within-persona granularity).
4. Migration 0016 (`platform_limits`) lands now; TS constants validated by
   a CI test against the SQL seed.
5. Persona switcher in sidebar punted to a later UI polish round.

### Gotchas to watch

- **Type generation:** `lib/db/types.ts` was edited by hand. Re-running
  `supabase gen types typescript` will produce a different formatting and
  ordering. Run it once and commit the diff to align.
- **Legacy fallback callers:** The 3 routes with `eslint-disable-next-line`
  comments are intentionally allowed. Don't delete those lines without
  also removing the `_legacy/` import.
- **CampaignDetail variant body:** The PostgREST embedded shape for
  `post_variants` under `campaign_persona_variants` may return either
  flat `body` or nested `post_variants.body`. The detail component
  tolerates both. If you ever normalize the join, you can simplify.
- **Pre-persona variants:** Production may still have `post_variants`
  rows with NULL `persona_id`. The cron + publish + regenerate paths all
  fall back to the workspace-default connection/brand for these. Once
  they age out, the `_legacy/` imports + their per-line disables can be
  deleted (this is what tips the system into a truly persona-only state).
- **Brand drift on pending variants:** Voice refresh between generation
  and approval no longer silently changes a variant's voice-of-origin —
  the `prompt_version_id` is now snapshotted on `campaign_persona_variants`.
  The UI doesn't yet surface "voice has changed since this was generated";
  add it when meaningful.

### What's left

Punted from this round (already in BACKLOG conceptually, not yet written):
- Per-persona analytics filtering on `/dashboard`.
- Persona switcher in the sidebar.
- Worker-side persona awareness beyond the system prompt string.
- "Voice has changed since this was generated" hint on approval cards.
- Deleting the `_legacy/` fallback once all pre-persona variants are gone.

### Next-step command

Smoke-test the end-to-end multi-persona flow against a real Supabase
project: run `supabase db push` to apply migrations 0015 and 0016, run
`pnpm --dir web dev`, and confirm:
1. Generating a campaign with 2 personas writes 2 content_items with
   `prompt_version_id` snapshotted.
2. Publishing a variant whose `persona_id` ≠ workspace-default uses that
   persona's tokens.
3. Failing a campaign (e.g. disconnect both platforms first) shows the
   red banner with `failure_reason` on the detail page.

---

## 2026-04-28 — Phase 7: Voice Profile + Inline Regeneration (complete)

### What got built

**Half A — Voice profiling**
- **Migrations 0012/0013** — `voice_profile JSONB` + `voice_profile_updated_at` on `brand_configs`; `source` column on `prompt_versions`; new append-only `post_variant_revisions` table with RLS
- **`worker/pipeline/voice_profile.py`** — Pydantic `VoiceProfile` schema + `analyze_samples()` LLM call + `render_system_prompt()` pure-Python renderer (split so renderer is re-runnable without LLM)
- **`worker/routes/voice.py`** — `POST /voice/analyze` (HMAC-guarded, 422 on schema failure)
- **`web/lib/db/brand-configs.ts`** — `setVoiceProfile`, `getVoiceProfile`
- **`web/lib/db/prompt-versions.ts`** — `PromptVersionSource` type; optional `source` param on `createPromptVersion`
- **`web/app/api/brand/voice-profile/route.ts`** — calls worker → writes voice profile → mints prompt_versions row → upserts brand_configs in one round trip; accepts `brand_details` for onboarding
- **`web/components/voice/VoiceSamplesPanel.tsx`** — 3–15 textarea samples, ProfileSummary prose, generated prompt preview, raw JSON toggle
- **`web/app/(app)/onboarding/_components/BrandStep.tsx`** — 3-state machine (choose → voice → manual); voice path forwards `brand_details` so no second save needed
- **`web/app/(app)/settings/brand/page.tsx`** — Voice Profile card with refresh flow

**Half B — Inline regeneration**
- **`worker/pipeline/regenerate.py`** — instruction-driven variant rewrite with anti-hallucination guardrail
- **`worker/routes/generate.py`** — `POST /generate/regenerate` added
- **`web/lib/worker-client.ts`** — `WorkerError` class; `workerAnalyzeVoice`, `workerRegenerate`
- **`web/lib/db/post-variant-revisions.ts`** — `snapshotVariantBody`, `listVariantRevisions`
- **`web/app/api/posts/[id]/regenerate/route.ts`** — snapshot → worker rewrite → update variant
- **`web/app/api/posts/[id]/revisions/route.ts`** — GET history, POST revert
- **`web/app/(app)/chat/_components/VariantCard.tsx`** — Refine button, quick-action chips, free-text instruction, revision badge, history panel with per-revision revert

**Tests:** 53 worker tests green; web typecheck clean

### What's left in Phase 7

Nothing — Phase 7 is complete. Deferred items remain in BACKLOG.md.

### Decisions made

- `VoiceProfile.tone.tone_register` in Python aliased to `"register"` in JSON via Pydantic `Field(alias=...)` — avoids shadowing `BaseModel.register`
- `analyze_samples` (LLM, stochastic) split from `render_system_prompt` (pure Python, deterministic) so prompt template improvements don't require re-running LLM
- `brand_details` forwarded to `/api/brand/voice-profile` so onboarding can finalize `brand_configs` in one round trip, avoiding a duplicate `prompt_versions` row
- JSONB for `voice_profile` — schema evolves without migrations; Pydantic model is schema-of-record

### Gotchas

- Pydantic v2 `BaseModel.register` conflict — always use `tone_register` as the Python attr; tests assert `.tone.tone_register` not `.tone.register`
- Stale `.next/dev/types/routes.d.ts` + `validator.ts` caused typecheck failures — deleted them; they are Next.js build artifacts and not source files
- Migration numbering: 0010 = post_metrics, 0011 = post_variant_media; 0012/0013 are Phase 7

### Next session first action

Start Phase 8 (Analytics / `post_metrics` population). Read `docs/BACKLOG.md` for the deferred performance-based learning item. Run `git status` to confirm clean tree.

---

## 2026-04-24 — Phase 6: Media Attachments (complete)

### What got built

- **Migration 0011** — `post_variant_media` join table (composite PK, RLS, index)
- **`web/lib/db/post-variant-media.ts`** — `getVariantMedia`, `setVariantMedia`, `getVariantMediaRaw`
- **`web/lib/adapters/cloudinary.ts`** — signed server-side upload (no SDK)
- **`web/lib/adapters/linkedin.ts`** — `registerLinkedInUpload`, `uploadBytesToLinkedIn`, `buildLinkedInPostBody` exported; `publishLinkedInPost` extended with optional `mediaUrns`
- **`web/lib/adapters/x.ts`** — `uploadMediaToX`, `buildTweetBody` exported; `publishTweet` extended with optional `mediaIds`
- **`web/lib/publish/upload-media.ts`** — `uploadMediaForPlatform` shared helper (non-fatal per-asset failures)
- **`web/app/api/posts/[id]/media/route.ts`** — GET (selection) + PUT (save selection, max 4)
- **`web/app/api/media/route.ts`** — GET `?job_id=` for listing image assets from an ingestion job
- **`web/app/api/media/upload/route.ts`** — POST user file → Cloudinary → media_asset row
- **`web/lib/db/media-assets.ts`** — `createUserUploadMediaAsset` for user-uploaded files (no job_id)
- **`web/app/api/posts/[id]/publish/route.ts`** — media fetch + upload step before platform publish
- **`web/app/api/cron/publish-due/route.ts`** — same media step via admin client (no user JWT)
- **`web/app/(app)/chat/_components/MediaPicker.tsx`** — standalone picker component (thumbnail grid, file upload, debounced save)
- **`web/app/(app)/chat/_components/VariantCard.tsx`** — renders `MediaPicker` below post body; hidden after terminal state

### What's left in Phase 6

Nothing. Phase 6 (Polish) is still the current phase but the media attachments feature is fully shipped.

### Gotchas hit

- `Buffer` → `Uint8Array` cast required in cloudinary.ts, linkedin.ts, x.ts for strict TS `BlobPart`/`BodyInit` compatibility.
- `GET /api/posts/:id/media` must remap `media_asset_id` → `id` in the response so it matches the shape `GET /api/media` returns and `MediaPicker.tsx` expects.
- `web/proxy.ts` was deleted during implementation and a `web/middleware.ts` was created in its place — caused `fetch failed` errors from the Supabase auth client. Restored `proxy.ts` with correct `export async function proxy()` signature.
- Cron publisher cannot use `getVariantMedia` (user-scoped client) — must query `post_variant_media` directly via the admin client.

### Next session first step

Phase 6 polish continues. Review `docs/BACKLOG.md` for any outstanding items.

---

## 2026-04-23 — Phase 5: Scheduling & Cron

### What got built

- **Migration 0008** — `posting_schedules` table (workspace×platform×time slot, IANA timezone, RLS, indexes)
- **Migration 0009** — `claim_due_variants(p_worker_id, p_limit)` SQL function with `FOR UPDATE SKIP LOCKED`, restricted to `service_role`
- **`web/lib/db/schedule-utils.ts`** — `nextSlots(schedules, count, after)` pure utility; converts schedule rows to upcoming UTC datetimes using `Intl.DateTimeFormat` (no external timezone package)
- **`web/lib/db/posting-schedules.ts`** — CRUD helpers (`getScheduleSlotsForWorkspace`, `createScheduleSlot`, `deleteScheduleSlot`, `getNextSlotsForWorkspace`)
- **`web/lib/adapters/linkedin.ts`** — added `refreshLinkedInToken()`
- **`web/lib/adapters/x.ts`** — added `refreshXToken()`
- **`web/app/api/schedule-slots/route.ts`** — GET (list slots + next 5 UTC datetimes) / POST (create slot)
- **`web/app/api/schedule-slots/[id]/route.ts`** — DELETE slot
- **`web/app/api/cron/publish-due/route.ts`** — sweeper + `claim_due_variants` RPC + parallel publish + attempt logging; auth via `CRON_SECRET`
- **`web/app/api/cron/token-expiry-check/route.ts`** — finds connections expiring within 7 days, attempts token refresh, sets `needs_reauth = true` on failure
- **`vercel.json`** — cron schedule (`*/5 * * * *` for publish-due, `0 6 * * *` for token-expiry-check)
- **`web/app/(app)/settings/layout.tsx`** — settings sidebar nav (Brand / Connections / Posting Schedule)
- **`web/app/(app)/settings/schedule/page.tsx`** — posting schedule UI; per-platform slot lists with add/remove, shows next 3 upcoming slots
- **`web/app/(app)/chat/_components/VariantCard.tsx`** — Schedule button now fetches next slots first; shows slot buttons if configured, custom datetime picker with Settings hint otherwise
- **`web/lib/db/types.ts`** — manually added `posting_schedules` table types and `claim_due_variants` function type (pending `pnpm gen:types` once migration is applied to Supabase project)
- Tests: 10 unit tests for `nextSlots()` (all pass); full suite 40/40 green

### What's left in Phase 5

All acceptance criteria are implemented. Pending manual steps:
- Apply migrations 0008 and 0009 to the Supabase project (`supabase db push` or paste into SQL editor)
- Run `pnpm --dir web gen:types` to regenerate types from Supabase (then remove the manual `posting_schedules` block from `types.ts`)
- Add `CRON_SECRET` env var to `.env.local` and Vercel
- Test schedule slot creation + VariantCard schedule flow end-to-end
- Verify Vercel plan supports 5-minute crons (Pro required; Hobby minimum is daily)

### Decisions made

- Used `Intl.DateTimeFormat` for timezone conversion instead of adding `luxon`/`date-fns-tz` — no new npm packages needed; acceptable precision for scheduling
- `claim_due_variants` is a `SECURITY DEFINER` SQL function (not JS-level `FOR UPDATE SKIP LOCKED`) to ensure the claim is atomic inside a single Postgres transaction
- `nextSlots` generates `count` candidates per schedule so a single-schedule workspace can still get 5 upcoming slots (via `multipleOccurrences` helper)

### Gotchas

- X free tier may not issue a refresh token even with `offline.access` scope; `token-expiry-check` sets `needs_reauth = true` in that case
- Vercel Hobby crons fire at most daily — `*/5 * * * *` silently becomes daily on Hobby plans

### Next session

Phase 6 — Analytics. First action: define Phase 6 scope with user, write `docs/phases/PHASE_6_ANALYTICS.md`.

---

## 2026-04-23 — Phase 4 complete: Publishing pipeline

**What got built:**

- Migration `0007_publish_attempts.sql` applied — `publish_attempts` table with RLS + indexes; added `platform_post_id`, `platform_post_url`, `error_code` to `post_variants`
- `web/lib/db/types.ts` regenerated after migration
- `web/lib/adapters/x.ts` — X/Twitter OAuth 2.0 PKCE adapter: `buildAuthorizationUrl`, `exchangeCodeForTokens`, `getUserInfo`, `publishTweet`
- `web/lib/adapters/linkedin.ts` — added `publishLinkedInPost` with LinkedIn UGC Posts API + idempotency header; updated OAuth scope to include `w_member_social`
- `web/lib/db/publish-attempts.ts` — `createPublishAttempt`, `updatePublishAttempt`, `getLatestAttempt`, `hasSuccessfulAttempt`
- `web/lib/db/posts.ts` — added `getPostVariant`, `updatePostVariant`
- `web/app/api/oauth/x/start/route.ts` — PKCE flow: generates code_verifier, stores in httpOnly cookie, redirects to X
- `web/app/api/oauth/x/callback/route.ts` — validates state + PKCE, exchanges code, stores tokens in Vault, upserts `social_connections`; sets `needs_reauth = true` when no refresh token returned
- `web/app/api/posts/[id]/publish/route.ts` — state machine guard, idempotency check, vault token read, platform dispatch (LinkedIn or X), attempt logging
- `web/app/api/posts/[id]/schedule/route.ts` — validates future datetime, sets `status = 'scheduled'`
- `web/app/api/posts/[id]/cancel/route.ts` — guards `status = 'scheduled'`, sets `status = 'cancelled'`
- `web/app/(app)/chat/_components/VariantCard.tsx` — extracted component with local action state: Publish Now (spinner → published + link), Schedule (datetime picker → confirmed), Cancel; shows errors with dismiss
- `web/app/(app)/chat/page.tsx` — replaced inline disabled buttons with `<VariantCard />`
- `web/app/(app)/settings/connections/page.tsx` — added X/Twitter connection card with status + reconnect link
- `web/app/(app)/onboarding/_components/ConnectStep.tsx` — added "Connect X / Twitter" button
- `web/tests/adapters.x.test.ts` — 5 tests: URL structure, PKCE params, scopes, state uniqueness
- `web/tests/db.publish-attempts.test.ts` — type-level tests for `publish_attempts` and Phase 4 `post_variants` columns
- `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/DECISIONS.md` updated

**Confirmed working:**

- `pnpm --dir web typecheck` — 0 errors
- `pnpm --dir web test` — 30/30 passing (was 21)
- Migration `0007_publish_attempts.sql` applied cleanly to remote Supabase
- `pnpm --dir web gen:types` — types regenerated

**Decisions made:**

- `createAdminClient` now also permitted in `publish/route.ts` for Vault reads (see DECISIONS.md)
- `attempt_number` computed dynamically via `getLatestAttempt` — hardcoding `1` would fail on retry after failure (unique constraint violation)
- X callback sets `needs_reauth = true` when no refresh token returned (X free tier may omit it)

**Gotchas:**

- LinkedIn `w_member_social` scope requires LinkedIn partner approval (submit review in LinkedIn Developer Portal). OAuth flow works immediately; `publishLinkedInPost` will return 403 until approved
- X publish rate limit on free tier: 17 tweets per user per 24h. `RATE_LIMITED` error_code surfaces this cleanly
- `scheduled_at` from `datetime-local` input is local time — `VariantCard` converts to UTC via `new Date(scheduledAt).toISOString()` before sending to the API
- Cron publisher for scheduled posts is **Phase 5 scope** — scheduled variants sit in DB with `status = 'scheduled'` until Phase 5 fires them

**What's next (Phase 5 — Scheduler & Cron):**

- `POST /api/cron/publish-due` — claims scheduled variants with `FOR UPDATE SKIP LOCKED`, calls platform adapters in parallel
- Token expiry cron (`/api/cron/token-expiry-check`)
- Sweeper: reset `publishing` variants stuck > 10 min back to `scheduled`
- `posting_schedules` table and smart slot assignment (optional for Phase 5)

**First action next session:**

- Create `web/app/api/cron/publish-due/route.ts`
- Create migration for any new tables needed (e.g. `posting_schedules`)

---

## 2026-04-23 — Phase 3 closeout patch: post_variants prompt provenance

**What got built:**

- Migration `0006_post_variants_prompt_version.sql` applied to remote Supabase
- Added `post_variants.prompt_version_id` FK to `prompt_versions(id)` with `ON DELETE SET NULL`
- Added index `idx_post_variants_prompt_version`
- `POST /api/posts` now writes `prompt_version_id` onto each inserted `post_variants` row
- Regenerated `web/lib/db/types.ts` after migration
- Updated `docs/DATA_MODEL.md` to document `post_variants.prompt_version_id`
- Updated `web/tests/db.posts.test.ts` to assert `PostVariantRow.prompt_version_id`

**Confirmed working:**

- `pnpm --dir web supabase db push --workdir ..` applied `0006_post_variants_prompt_version.sql`
- `pnpm --dir web gen:types` completed successfully
- `pnpm --dir web typecheck` — passes
- `pnpm --dir web test` — 21/21 passing

**Decisions made:**

- Prompt provenance must exist at both levels:
  - `content_items.prompt_version_id` for generation event provenance
  - `post_variants.prompt_version_id` for per-variant publish/audit provenance

**Gotchas:**

- Phase 4 plan previously referenced migration `0006_publish_attempts.sql`; migration numbering now starts at `0007` for publishing

**What's next (Phase 4 — Publishing):**

- Create migration `0007_publish_attempts.sql`
- Implement `POST /api/posts/[id]/publish`, `/schedule`, `/cancel`
- Add X OAuth start/callback and adapter

**First action next session:**

- Run `pnpm --dir web supabase db push --workdir ..` after creating `0007_publish_attempts.sql`

## 2026-04-23 — Phase 3 complete: AI generation pipeline

**What got built:**

- Migrations `0004_generation.sql` + `0005_content_items_indexes.sql` — `content_items`, `post_variants` tables with RLS, indexes, trigger
- Worker LLM adapters: `worker/adapters/groq.py`, `worker/adapters/gemini.py`, `worker/adapters/llm.py` (Groq primary, Gemini fallback)
- Worker pipeline: `worker/pipeline/analyze.py` (Pass 1: source → summary), `worker/pipeline/generate.py` (Pass 2: summary → platform variants)
- Worker route: `worker/routes/generate.py` — `POST /generate`
- Web: `workerGenerate()` added to `worker-client.ts`
- Web db layer: `web/lib/db/posts.ts` — `createContentItem`, `updateContentItem`, `createPostVariants`, `getContentItemWithVariants`, `listContentItemsForJob`
- Web db layer: `web/lib/db/brand.ts` — `getBrandConfig`
- Web route: `web/app/api/posts/route.ts` — `POST /api/posts` with full auth + Zod + stage tracking
- Browser Supabase client: `web/lib/supabase/browser.ts`
- Chat UI: full generation flow — platform picker, Realtime stage labels, variant display, Copy button

**Confirmed working:**

- `pnpm --dir web typecheck` — 0 errors
- `pnpm --dir web test` — 21/21 passing
- `cd worker && uv run pytest tests/` — 28/28 passing
- Both migrations applied to remote Supabase

**Decisions made:**

- Groq primary / Gemini fallback (see DECISIONS.md)
- Generation synchronous in Phase 3 (see DECISIONS.md)

**Gotchas:**

- `getBrandConfig` was missing from `web/lib/db/brand.ts` — had to create the file
- `google-generativeai` is deprecated (EOL) — tracked in `docs/BACKLOG.md`, must migrate to `google-genai` before production
- Supabase Realtime stage updates require the `ingestion_jobs` table to have replica identity; Supabase enables this by default on new projects
- `content_items` initially had only 2 indexes — added `0005_content_items_indexes.sql` to add the missing `prompt_version_id` and `created_at` indexes

**What's next (Phase 4 — Publishing):**

- X OAuth (start + callback routes, adapter)
- `publish_attempts` table
- `POST /api/posts/[id]/publish` (publish now)
- `POST /api/posts/[id]/schedule` (schedule)
- Cron: `POST /api/cron/publish-due`
- Enable "Publish now" and "Schedule" buttons in the UI

---

## 2026-04-23 — Phase 2 complete: Ingestion pipeline end-to-end

**What got built:**

- Migration `0003_ingestion.sql` applied — `ingestion_jobs`, `media_assets` tables with RLS; 5 indexes
- `web/lib/db/types.ts` regenerated; both new tables present
- Python worker scaffold:
  - `worker/pyproject.toml` + `uv.lock` (uv sync completed; 39 packages installed)
  - `worker/config.py` — pydantic-settings with lazy `get_settings()` + `@lru_cache`
  - `worker/auth.py` — HMAC-SHA256 verification (`X-Worker-Signature: sha256=<hex>`)
  - `worker/main.py` — FastAPI app with `/health` and ingest router
  - `worker/pipeline/scrape.py` — DNS-based SSRF guard + Playwright one-browser-per-request
  - `worker/pipeline/extract.py` — BeautifulSoup: og:title → title → h1; strip nav/footer/scripts; og:image + img[src] up to 5; relative URL resolution
  - `worker/pipeline/upload.py` — Cloudinary upload with non-fatal per-image error handling
  - `worker/routes/ingest.py` — thin route, delegates to pipeline; returns `IngestResponse` with `stage_timings`
  - `worker/tests/conftest.py` — sets dummy env vars before collection (no live creds needed)
  - `worker/tests/test_extract.py` — 9 tests covering title fallback, media ordering, nav stripping, relative URLs, max-5 cap
  - `worker/tests/test_ssrf.py` — 8 tests covering loopback, RFC-1918 ranges, AWS metadata, DNS failure, missing hostname
  - `worker/Dockerfile` + `worker/fly.toml`
- Web layer:
  - `web/lib/worker-client.ts` — HMAC-signed typed fetch client
  - `web/lib/db/ingestion.ts` — `createIngestionJob`, `updateIngestionJob`, `getIngestionJob`, `countRecentJobs`
  - `web/lib/db/media-assets.ts` — `createMediaAssets`, `getMediaAssetsForJob`
  - `web/app/api/ingest/route.ts` — POST: Zod validation, LinkedIn guard, rate-limit (2/min, 50/day), synchronous worker call, status updates
  - `web/app/api/ingest/[job_id]/route.ts` — GET with explicit workspace ownership check
- Chat UI:
  - `web/app/(app)/chat/page.tsx` — client component; `idle → loading → success | error` states; extracted title + text preview (400 char + "Show more") + Cloudinary thumbnail grid; disabled "Generate post →" with tooltip; ⌘+Enter submit
- Tests:
  - `web/tests/db.ingestion.test.ts` — 7 type-level Vitest tests for `ingestion_jobs` and `media_assets`
- Docs updated: `DATA_MODEL.md` (Phase 2 section), `API_CONTRACTS.md` (Phase 2 section), `.env.example` (`WORKER_URL`, `WORKER_SHARED_SECRET`)

**Confirmed working:**

- `pnpm --dir web typecheck` — passes (0 errors)
- `pnpm --dir web test` — 17/17 tests pass
- `cd worker && uv run pytest tests/` — 17/17 tests pass
- `pnpm --dir web supabase db push --workdir ..` — migration applied cleanly
- `pnpm --dir web gen:types` — types regenerated with `ingestion_jobs` and `media_assets`

**Decisions made:**

- `config.py` uses `@lru_cache` on `get_settings()` so tests can set env vars in `conftest.py` before the first import triggers `Settings()`. Avoids having to mock pydantic-settings.
- `extract.py` takes a `base_url` parameter so relative image src values can be resolved against the page origin. Without it, relative URLs are silently skipped (no crash).
- Chat page uses a single `InputForm` component rendered in three states (idle, error, success) rather than duplicating the textarea. Keeps the re-submit flow clean.
- Phase 2 route is synchronous (waits for worker). Phase 3 will switch to async + Supabase Realtime when LLM calls extend total time to 10–20s.

**What's next (Phase 3 — Generation):**

- `content_items` and `post_variants` tables (migration 0004)
- Worker `/generate` endpoint: Pass 1 (LLM summarize source) + Pass 2 (LLM generate platform variants)
- `web/lib/adapters/` LLM adapter (Groq primary, Gemini fallback)
- Switch ingest route to async + Supabase Realtime stage updates
- Enable "Generate post →" button on the chat page

**Gotchas to watch:**

- `uv.lock` must be committed — Fly.io build depends on it for reproducibility.
- `worker/.env` (gitignored) must be created locally with real `WORKER_SHARED_SECRET` + `CLOUDINARY_*` values before `uv run fastapi dev` works.
- Vercel Hobby function timeout is 10s — scraping fast pages is fine but slow blogs may exceed it. If this becomes a problem on Hobby, upgrade to Pro (60s timeout) before Phase 3.
- The `worker/tests/conftest.py` only sets dummy values; Cloudinary upload tests in Phase 3 will need a real creds strategy (env-based skip or VCR cassettes).

---

## 2026-04-22 — Phase 1 complete: Auth, Brand, and LinkedIn OAuth

**What got built:**

- Migration `0002_brand_and_connections.sql` applied — `brand_configs`, `prompt_versions`, `social_connections` tables with RLS; `touch_updated_at()` trigger; `vault_create_secret` / `vault_read_secret` SQL helpers (service_role only)
- `web/lib/db/types.ts` regenerated; all three new tables present
- `web/lib/security/vault.ts` — Supabase Vault helpers (create/read secrets via admin client RPC)
- `web/lib/db/brand-configs.ts` — `getBrandConfig`, `upsertBrandConfig`
- `web/lib/db/prompt-versions.ts` — `createPromptVersion` (auto-increments version_number), `getLatestPromptVersion`
- `web/lib/db/social-connections.ts` — `getSocialConnection`, `upsertSocialConnection` (accepts optional client override for OAuth callback)
- `web/lib/adapters/linkedin.ts` — `buildAuthorizationUrl`, `exchangeCodeForTokens`, `getUserInfo` with Zod validation
- `web/app/api/brand/config/route.ts` — GET (read current config) + POST (upsert + new prompt version)
- `web/app/api/oauth/linkedin/start/route.ts` — generates state, sets httpOnly cookie, redirects to LinkedIn
- `web/app/api/oauth/linkedin/callback/route.ts` — validates state, exchanges code, stores tokens in Vault, upserts social_connections
- `web/app/(app)/layout.tsx` — onboarding gate: checks `brand_configs` and redirects to `/onboarding` if missing
- `web/lib/supabase/middleware.ts` — injects `x-pathname` header so the layout can read current route without a client hook
- `web/app/(app)/onboarding/page.tsx` + 3 step components (`BrandStep`, `ConnectStep`, `TestPostStep`)
- `web/app/(app)/settings/brand/page.tsx` — client component, fetches + saves brand config
- `web/app/(app)/settings/connections/page.tsx` — server component, shows LinkedIn connection status
- `components/ui/textarea.tsx` added via shadcn (needed by brand forms)
- Tests: `db.brand-configs.test.ts` (type-level, 3 tests), `adapters.linkedin.test.ts` (4 tests) — 11/11 pass
- `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/BACKLOG.md` updated
- Google OAuth deferred to `docs/BACKLOG.md`

**Confirmed working:**

- `pnpm --dir web typecheck` — passes (0 errors)
- `pnpm --dir web test` — 11/11 tests pass
- `pnpm supabase db push --workdir ..` — migration applied cleanly

**Decisions made:**

- `lib/security/vault.ts` accepts a `SupabaseClient` parameter rather than importing `createAdminClient` directly, keeping admin import rule contained to route files
- `upsertSocialConnection` accepts an optional `clientOverride` parameter so the OAuth callback (which already holds an admin client) can pass it without a second client instantiation
- Onboarding gate uses `x-pathname` header injected by middleware rather than a separate nested route group
- Google OAuth skipped per user instruction; noted in BACKLOG.md

**What's next (Phase 2 — Ingestion):**

- Write `docs/phases/PHASE_2_INGESTION.md` brief before starting code
- Python worker scaffold: FastAPI, `routes/ingest.py`, Playwright scraping, Cloudinary upload
- `web/app/api/ingest/route.ts` — creates `ingestion_jobs` row, calls worker, updates status
- `ingestion_jobs` and `media_assets` tables (migration 0003)
- Chat UI (`/chat`) with URL input and job status polling

**Gotchas to watch:**

- The onboarding gate in `(app)/layout.tsx` does two sequential DB queries (workspace + brand_config) on every protected page load. Fine for V1; consider caching in Phase 5+ if latency becomes an issue.
- `vault_create_secret` is called once per token, so a LinkedIn connect creates 1–2 vault entries. If the connection is re-established, old vault entries become orphaned (no automatic cleanup). Add a cleanup step if Vault storage becomes a concern.
- `upsertSocialConnection` with `onConflict: 'workspace_id,platform'` requires the unique constraint name to match exactly. Verified it's `social_connections_workspace_platform_unique` in the migration.

---

## 2026-04-22 — Phase 0 closeout + Phase 1 brief authored

**What got built / finalized:**

- Supabase CLI login and project linking verified for project `igrzkqtidqjwmxzqlawm`
- Foundation migration `0001_foundation.sql` applied against the correct repo root workdir (`--workdir ..`)
- Confirmed remote schema now includes `profiles`, `workspaces`, and `workspace_members`
- Regenerated `web/lib/db/types.ts` from real schema; verified Phase 0 tables appear in generated types
- Added complete Phase 1 implementation brief in `docs/phases/PHASE_1_AUTH_BRAND.md`

**What's confirmed working:**

- `pnpm --dir web typecheck` passes
- `pnpm --dir web test` passes
- `pnpm supabase db push --workdir ..` applies foundation migration cleanly
- `pnpm --dir web gen:types` / `pnpm exec supabase gen types ...` produce valid TypeScript definitions

**What's next:**

- Start Phase 1 implementation from the new brief:
	onboarding wizard, Google login button, LinkedIn OAuth routes, `0002_brand_and_connections.sql`, and settings pages.

---

## 2026-04-22 — Phase 0 implementation

**What got built:**

- Next.js 16.2.4 app scaffolded in `web/` (TypeScript strict, Tailwind v4, App Router, pnpm)
- `lib/supabase/{server,admin,client,middleware}.ts` — three-client Supabase setup using `@supabase/ssr` with `getAll`/`setAll` cookie pattern; `cookies()` is async in Next.js 16 and awaited correctly
- `middleware.ts` at repo root — session refresh on every request; redirects logged-out users to `/login` and logged-in users away from auth pages
- `app/(auth)/` route group — `/login` and `/signup` pages (email/password, shadcn/ui), email confirmation callback at `/auth/callback`
- `app/(app)/` route group — server-side auth guard in layout, `/dashboard` showing "Hello, {user.email}", `TopBar` client component with logout
- `lib/db/types.ts` — generated from real Supabase schema via `pnpm gen:types`; `scripts/gen-types.mjs` helper avoids PowerShell UTF-16 encoding issue
- `lib/db/workspaces.ts` — `getWorkspaceForUser()` db helper
- `supabase/migrations/0001_foundation.sql` — `profiles`, `workspaces`, `workspace_members` tables; RLS policies; `user_workspace_ids()` fn; `handle_new_user()` signup trigger; applied to Supabase project via `db push`
- `tests/smoke.test.ts` + `vitest.config.ts` — 3/3 passing
- `.github/workflows/ci.yml` — typecheck + test on push/PR to main
- shadcn/ui: button, input, label, card components; Supabase CLI installed as local dev dep (`pnpm supabase`)

**Decisions made:**

- Accepted Next.js 16.2.4 (latest at time of build) instead of 15; updated CLAUDE.md and ARCHITECTURE.md accordingly
- Supabase CLI installed as local pnpm dev dependency (no global install); `pnpm.onlyBuiltDependencies` used to allow its postinstall binary download

**What's left in Phase 0 (not code — needs manual verification):**

- [ ] `pnpm --dir web dev` starts locally and smoke-test the signup/login/dashboard/logout flow end-to-end
- [ ] Verify signup trigger fires (check Supabase Table Editor for profiles/workspaces/workspace_members rows)
- [ ] CI passes on a pushed PR
- [ ] Vercel deployment with env vars set

**Next session's first action:** Read CLAUDE.md (now Phase 1), ARCHITECTURE.md, DATA_MODEL.md, `docs/phases/PHASE_1_AUTH_BRAND.md`, and top of SESSION_NOTES.md. Phase 1 adds Google OAuth login, onboarding wizard, brand config CRUD, and prompt versioning.

**Gotchas to remember:**

- `cookies()` from `next/headers` returns a Promise in Next.js 16 — always `await` it before passing to `createServerClient`
- PowerShell `>` writes UTF-16; always use `pnpm gen:types` (the Node.js helper script) to regenerate types, never raw PowerShell redirection
- Supabase CLI runs as `pnpm supabase <cmd>` from inside `web/`; `supabase link` must be run before `db push` or `gen types`
- The `(app)/layout.tsx` does a server-side `auth.getUser()` check — this is intentional redundancy on top of middleware for defence-in-depth

---

## 2026-04-22 — Scaffolding (pre-code)

**What got built:** Repo scaffolding only. No code yet.

- `CLAUDE.md` — project operating manual
- `docs/ARCHITECTURE.md` — stack, folder layouts, patterns, request lifecycle
- `docs/DATA_MODEL.md` — Phase 0 schema (profiles, workspaces, workspace_members) and conventions for future tables
- `docs/API_CONTRACTS.md` — empty placeholder, will grow per phase
- `docs/DECISIONS.md` — pre-seeded with 8 foundational decisions (stack, no LangGraph, no LinkedIn scraping, workspaces-from-day-one, prompt versioning, content_items/post_variants split, Vault for tokens, SKIP LOCKED for cron claim)
- `docs/phases/PHASE_0_FOUNDATION.md` — detailed brief for Phase 0
- `docs/BACKLOG.md` — empty
- `.env.example` — all vars across all phases, empty values
- `README.md` — human-facing quickstart

**What's left in the current phase (Phase 0):** Everything. No code has been written.

**Next session's first action:** Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/phases/PHASE_0_FOUNDATION.md`. Then summarize back the plan and ask any clarifying questions before scaffolding the Next.js app.

**Gotchas to remember for the first coding session:**

- Use `@supabase/ssr`, not the deprecated `@supabase/auth-helpers-nextjs`.
- The signup trigger function needs `SECURITY DEFINER` or it won't be able to insert into `workspaces`.
- Tailwind must be installed *before* `npx shadcn@latest init`.
- Remember to run `supabase login` and `supabase link --project-ref ...` before generating types.
- Commit after every working increment — every green `pnpm typecheck` is a valid checkpoint.

---