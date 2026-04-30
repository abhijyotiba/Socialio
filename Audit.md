# SocialOS — Production Readiness Audit

> Audited: April 28 2026  
> Scope: `web/` (Next.js 16) + `worker/` (FastAPI)

---

## Table of Contents
1. Critical / Security Issues
2. Bugs & Logic Errors
3. Dependency Conflicts & Version Risks
4. Dead / Redundant Code
5. Missing Error Handling
6. Performance Concerns
7. Type Safety Gaps
8. Test Coverage Gaps
9. Recommended Fixes (copy-paste ready)
10. Priority Matrix

---

## 1. Critical / Security Issues

### 1.1 `middleware.ts` is never wired up
**File:** `web/proxy.ts`  
**Problem:** The file is named `proxy.ts` but Next.js middleware **must** live in `middleware.ts` (or `middleware.js`) at the root of the project. Because the file is misnamed, **no auth protection is applied at all** — every route is publicly accessible regardless of session state. The export is correct (`export async function proxy`) but the filename means Next.js never loads it.

**Fix:** Rename `web/proxy.ts` → `web/middleware.ts` and change the export:
```ts
// web/middleware.ts
export { proxy as default } from './proxy'; // or just rename function to default
export const config = { ... } // already present
```
Or simply rename the file and export as `default`:
```ts
export default async function middleware(request: NextRequest) { ... }
```

---

### 1.2 Admin Supabase client leaked into user-facing publish route
**File:** `web/app/api/posts/[id]/publish/route.ts` (lines ~100–110)  
**Problem:** The route comment acknowledges this is a "permitted exception" but the real issue is that the service-role key is used to read Vault secrets in a route callable by any authenticated user. If an attacker forges or replays a request with a valid session (their own) and a target post ID they enumerate, they hit the admin client. The actual ownership check is correct (workspace guard at line ~55), but the pattern should be audited: any `createAdminClient()` in a user-callable route is a risk surface.

**Fix:** Move Vault reads to the server-side cron only, and have publish routes call the worker which holds the secret instead. If keeping the pattern, at minimum add rate-limiting and log every admin client instantiation.

---

### 1.3 `CRON_SECRET` not validated on all cron routes
**Files:** `web/app/api/cron/publish-due/route.ts`, `pull-metrics/route.ts`, `token-expiry-check/route.ts`  
**Problem:** All three check `if (!verifyCronAuth(request)) return 401`, which is correct. However `verifyCronAuth` returns `false` when `process.env.CRON_SECRET` is `undefined`:
```ts
const secret = process.env.CRON_SECRET;
if (!secret) return false;
```
This means **if the env var is missing the cron is silently blocked forever** with no startup warning. Worse, there is no startup validation that this var is set, so a misconfigured deployment quietly breaks all scheduled publishing.

**Fix:** Add startup env validation (see Section 9).

---

### 1.4 SSRF guard only checks DNS at call time (redirect bypass)
**File:** `worker/pipeline/scrape.py`  
**Problem:** `_is_ssrf_safe()` resolves DNS once, but `playwright` then follows HTTP redirects. A server at a public IP could redirect to `http://169.254.169.254/`. The comment in the code even notes this:
```python
"""DNS-based SSRF guard. String-matching is bypassable via decimal/octal IPs or redirects."""
```
**Fix:** Pass `--proxy-server="..."` args to Playwright or block redirects in httpx fallback by setting `follow_redirects=False` and manually re-checking each redirect destination.

---

### 1.5 `X-Worker-Signature` HMAC uses `hmac.new` (wrong function)
**File:** `worker/auth.py`, line 13  
**Problem:**
```python
expected = "sha256=" + hmac.new(
    settings.worker_shared_secret.encode(),
    body,
    hashlib.sha256,
).hexdigest()
```
`hmac.new` does not exist in Python's standard library — the correct function is `hmac.new` … actually in Python it IS `hmac.new()` as an alias. **BUT** the arguments are wrong: `hmac.new(key, msg, digestmod)` requires `digestmod` as the third positional arg — this is actually correct. However the comparison uses `hmac.compare_digest` without importing it from `hmac`. Double-check this works; in Python 3.11 `hmac.compare_digest` is fine. **The real bug** is in `web/lib/worker-client.ts`:
```ts
import { createHmac } from "crypto";
// body is JSON.stringify(req)
```
This is correct. But if `WORKER_SHARED_SECRET` is undefined, `createHmac` will throw at runtime with a cryptic error. Add a startup check.

---

### 1.6 No rate limiting on `/api/media/upload`
**File:** `web/app/api/media/upload/route.ts`  
**Problem:** Users can upload unlimited images (10 MB each) per minute. There is rate-limiting on `/api/ingest` (2/min, 50/day) but none on media uploads. This is a storage-cost and abuse vector.

**Fix:** Add per-workspace rate limiting (e.g., 20 uploads/hour via the same `countRecentJobs` pattern, or middleware).

---

### 1.7 LinkedIn OAuth state cookie deleted before token exchange
**File:** `web/app/api/oauth/linkedin/callback/route.ts`, lines 34–38  
**Problem:**
```ts
cookieStore.delete("linkedin_oauth_state");
// ... then tries to exchange code for tokens
```
The cookie is deleted **before** the token exchange. If the exchange fails, the user can't retry (state is gone). This is minor UX but can cause "Invalid state" errors on retry.

**Fix:** Delete the cookie only after a successful exchange, or inside a try/finally.

---

## 2. Bugs & Logic Errors

### 2.1 `revisions/route.ts` POST returns no `revision_number`
**File:** `web/app/api/posts/[id]/revisions/route.ts` (POST handler, line ~85)  
**Problem:** The revert endpoint updates the variant body and returns `{ body: target.body }` but does NOT return `revision_number`. The frontend `VariantCard.tsx` calls this endpoint and sets `setRevisionNumber(data.revision_number)` — this will always be `undefined` after a revert, losing the version badge.
```ts
return NextResponse.json({ body: target.body });
// Missing: revision_number
```
**Fix:**
```ts
const newRevision = await snapshotVariantBody({ ... });
return NextResponse.json({ body: target.body, revision_number: newRevision.revision_number });
```

---

### 2.2 `VariantCard.tsx` — `showHistory` toggle doesn't reset on revert
**File:** `web/app/(app)/chat/_components/VariantCard.tsx`, `handleRevert`  
**Problem:** After a successful revert, `setRevisions([])` and `setShowHistory(false)` are called. But the `revisionNumber` is set to `data.revision_number` which is `undefined` (see 2.1). This makes the "history" button appear but clicking it loads an empty state.

---

### 2.3 `chat/page.tsx` — `togglePlatform` is not passed correctly to `ExtractionCard`
**File:** `web/app/(app)/chat/page.tsx`, line ~213  
**Problem:** `togglePlatform` in the page is defined as:
```ts
function togglePlatform(p: "linkedin" | "x") { ... }
```
And `ExtractionCard` has `onTogglePlatform: (p: "linkedin" | "x") => void`. This is type-correct. However, the `platforms` state is shared across ALL `ExtractionCard` instances in the conversation — if you generate two different posts, toggling platform on card 1 affects which platforms show selected on card 2. Each extraction card should manage its own platform selection.

---

### 2.4 `dashboard/page.tsx` — `impressionVals` / `likeVals` may be < 2 items, breaking chart
**File:** `web/app/(app)/dashboard/page.tsx`, `smoothPath` function  
**Problem:** `smoothPath` returns `""` if `pts.length < 2`. If a user has exactly 1 published post, `impressionVals` will have 1 element and the chart renders blank with no feedback.

---

### 2.5 `getPostVariant` returns `null` on DB error — silently swallowed
**File:** `web/lib/db/posts.ts`  
**Problem:**
```ts
export async function getPostVariant(id: string): Promise<PostVariantRow | null> {
  const { data, error } = await supabase...
  if (error) return null;
  return data;
}
```
A real DB error (connection timeout, RLS violation) returns `null` which the caller interprets as "not found" and returns 404. This hides infrastructure failures.

**Fix:** Throw on actual DB errors, only return `null` on `PGRST116` (row not found):
```ts
if (error) {
  if (error.code === 'PGRST116') return null;
  throw error;
}
```

---

### 2.6 `MediaPicker.tsx` — available media not reloaded after user upload
**File:** `web/app/(app)/chat/_components/MediaPicker.tsx`  
**Problem:** The `available.length > 0` guard in the `useEffect` prevents reloading after a user uploads a new image via the upload button. The new asset is prepended to `available` state directly (`setAvailable((prev) => [newAsset, ...prev])`), which is correct. But the guard means if media was loaded once (even if empty), it never re-fetches. This is fine, **but** if `jobId` changes while `isOpen` is true, the old media list remains.

---

### 2.7 `PostDetailDrawer.tsx` — body PATCH max length is 3000 but LinkedIn allows 3000
**File:** `web/app/api/posts/[id]/route.ts`, `patchSchema`  
**Problem:**
```ts
const patchSchema = z.object({
  body: z.string().min(1).max(3000),
});
```
LinkedIn allows up to 3000 chars. But X allows only 280. The PATCH endpoint applies a single 3000-char limit to both platforms. A user could save a 2000-char body for an X post via the drawer (bypassing the frontend char counter), and it would succeed — then fail at publish time.

**Fix:** Fetch the variant's platform in the PATCH handler and apply platform-specific limits.

---

### 2.8 `cron/publish-due` sweeper condition is inverted
**File:** `web/app/api/cron/publish-due/route.ts`, line ~52  
**Problem:**
```ts
.lt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
```
This sweeps rows where `claimed_at` is **less than** (older than) 10 minutes ago — that is correct. But the status is set back to `"scheduled"` not `"draft"`, so if the worker crashed mid-publish, the post re-enters the queue and could be double-published if it already partially succeeded. The `hasSuccessfulAttempt` check in `publishVariant` handles this, but only if the `publish_attempts` row was written before the crash.

---

### 2.9 `snapshotVariantBody` — race condition on revision numbering
**File:** `web/lib/db/post-variant-revisions.ts`  
**Problem:** The function reads the latest `revision_number`, increments it in application code, then inserts. Two simultaneous regeneration requests on the same variant will both read the same `revision_number` and one insert will fail (or silently write a duplicate). This should be a DB sequence or a `MAX(...) + 1` inside a single SQL statement.

---

## 3. Dependency Conflicts & Version Risks

### 3.1 `react@19.2.4` + `@base-ui/react@^1.4.1` — unstable pairing
**File:** `web/package.json`  
React 19 is released but many ecosystem packages still declare peer deps of `react@^18`. `@base-ui/react` 1.x targets React 19, which is fine. But `lucide-react@^1.8.0` has peer deps of `react@^16||^17||^18` — this will throw a peer dep warning on install (pnpm) and may break in strict mode. Verify `lucide-react` 1.x actually supports React 19.

### 3.2 `next@16.2.4` — this version does not exist
**File:** `web/package.json`  
As of April 2026, Next.js latest stable is 15.x. A version `16.2.4` does not exist on npm. If this is an internal/alpha build, ensure the version resolves. If it's a typo for `15.2.4`, fix it. The `AGENTS.md` warning about "breaking changes" suggests this is intentional, but it creates a reproducibility risk if the version isn't published to a registry all environments can reach.

### 3.3 `zod@^4.3.6` breaking changes from v3
**File:** `web/package.json`  
Zod v4 introduced breaking API changes (`.safeParse` result shape changed slightly, `z.string().email()` behavior changed). All API routes use `.safeParse` and check `parsed.success` which is v4-compatible. However, `.flatten()` on errors was changed in v4 — verify all `parsed.error.flatten()` calls still return the expected shape for your frontend error display.

### 3.4 Worker: `google-genai>=1.0` vs `groq>=0.9` async interfaces differ
**File:** `worker/pyproject.toml`  
`google-genai` 1.x uses `client.aio.models.generate_content(...)` (async). `groq` 0.9+ uses `AsyncGroq` with `.chat.completions.create(...)`. Both are used correctly in the adapters. However `google-genai` 1.x renamed several methods from the 0.x line — if the lock file pins an older version you may get `AttributeError: 'AsyncModels' object has no attribute 'generate_content'`.

### 3.5 `pydantic>=2.7` + `pydantic-settings>=2.2` — model serialization alias issue
**File:** `worker/pipeline/voice_profile.py`, `ToneProfile`  
```python
tone_register: ... = Field(alias="register", serialization_alias="register")
```
In Pydantic v2, `alias` controls both input and output by default. Using both `alias` and `serialization_alias` is valid in v2.7+ but the `model_dump(mode="json")` in `routes/voice.py` will output the key as `"register"` (serialization_alias), which is what the DB schema expects. However, when constructing `ToneProfile` from a dict that uses `"register"` as key (from the LLM response), Pydantic will look for `"register"` (the alias) — this is correct. The potential issue is `model_config = ConfigDict(populate_by_name=True)` — verify this doesn't cause double-acceptance of both `"register"` and `"tone_register"` from untrusted LLM input.

### 3.6 `tw-animate-css@^1.4.0` — may conflict with Tailwind v4
**File:** `web/package.json`  
Tailwind v4 completely rewrote the plugin API. `tw-animate-css` 1.x was written for Tailwind v3. It's imported in `globals.css` as `@import "tw-animate-css"` which works if the package exports a CSS file directly — verify this resolves correctly with the `@tailwindcss/postcss` v4 pipeline.

### 3.7 `shadcn@^4.4.0` vs `@base-ui/react` — dual component libraries
**File:** `web/package.json`, `web/components.json`  
The project installs `shadcn` (CLI tool) and uses `@base-ui/react` for primitives (`Button`, `Input`). Components like `Button` import from `@base-ui/react/button` directly. The `components.json` specifies `"style": "base-nova"` which is the Base UI + shadcn combo. This is fine architecturally, but it means there are TWO component systems in the repo — the `TopBar.tsx` component is never used (see Section 4) and uses neither system, increasing confusion.

---

## 4. Dead / Redundant Code

### 4.1 `TopBar.tsx` — completely unused
**File:** `web/components/app/TopBar.tsx`  
The sidebar-based layout (`Sidebar.tsx`) replaced this. `TopBar.tsx` is never imported anywhere. **Delete it.**

### 4.2 `web/app/(app)/layout.tsx` — `onOnboarding` logic is fragile
**File:** `web/app/(app)/layout.tsx`  
```ts
const onOnboarding = pathname.startsWith("/onboarding") || pathname === "";
```
The fallback `pathname === ""` was added as a guard but `x-pathname` will never be an empty string in practice (it's always at least `/`). This condition is dead code.

### 4.3 `regenerate/route.ts` — double snapshot comment is misleading
**File:** `web/app/api/posts/[id]/regenerate/route.ts`  
The code takes a snapshot before the worker call (recording the pre-regeneration body) and then another snapshot after (recording the new body + instruction). The comment says "The instruction is recorded on the *next* snapshot" which contradicts what the code actually does (records it immediately). The behavior is correct but the comment is wrong and will confuse future maintainers.

### 4.4 `ingest/route.ts` — double `stage: "analyzing"` then `stage: "generating"` update
**File:** `web/app/api/posts/route.ts`, lines ~80–84  
```ts
await updateIngestionJob(ingestion_job_id, { stage: "analyzing" });
// Ensure we transition to generating before the worker call, or let worker handle it
await updateIngestionJob(ingestion_job_id, { stage: "generating" });
```
Two sequential DB writes that immediately overwrite each other. The `"analyzing"` stage is never visible to the user. Remove the first one.

### 4.5 `workerGenerate` — `job_id` param sent but worker doesn't use it
**File:** `worker/routes/generate.py`, `GenerateRequest`  
`job_id` is in the request body but the generate route never uses it. It was presumably from an earlier design. Remove it from both the Next.js `workerGenerate` call and the worker schema to avoid confusion.

### 4.6 `generateRequest` in `posts/route.ts` passes `job_id`
**File:** `web/app/api/posts/route.ts`, `workerGenerate` call  
Redundant with 4.5 — `job_id: ingestion_job_id` is passed but ignored by the worker.

### 4.7 `create_file` vs `createFile` in media-assets
**File:** `web/lib/db/media-assets.ts`  
`getVariantMediaRaw` is exported but never imported anywhere in the codebase. The only media fetch in publish uses `getVariantMedia` (joined). **Delete `getVariantMediaRaw`** or document why it exists.

### 4.8 `web/app/(app)/layout.tsx` — `getBrandConfig` null redirect
**File:** `web/app/(app)/layout.tsx`, lines ~30–37  
Every page load for an authenticated user does TWO extra DB queries (`getWorkspaceForUser` + `getBrandConfig`) just to check onboarding state. For a production app, this adds ~50–100ms to every server-rendered page. Consider caching this in a cookie or Supabase session custom claim.

### 4.9 Worker `main.py` — Windows event loop policy is unnecessary in production
**File:** `worker/main.py`  
```python
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
```
The worker runs on Fly.io (Linux). This block only matters for local Windows dev. Keep it, but add a comment — it's confusing in a production codebase without one.

---

## 5. Missing Error Handling

### 5.1 No global error boundary in Next.js app
**Files:** All page.tsx files  
There is no `error.tsx` or `global-error.tsx` in the app router. Unhandled server component errors will show Next.js's default error page (which leaks stack traces in dev and shows a blank page in prod). Add `web/app/error.tsx` and `web/app/global-error.tsx`.

### 5.2 `fetch("/api/connections")` failure not handled in `chat/page.tsx`
**File:** `web/app/(app)/chat/page.tsx`, line ~108  
```ts
.catch(() => {});
```
Silently swallowed. If the connections endpoint fails, `connectedPlatforms` stays `[]` and the ExtractionCard will show "No platforms connected" indefinitely, confusing users who ARE connected.

### 5.3 Supabase realtime channel never unsubscribed on unmount if `isGenerating` becomes false first
**File:** `web/app/(app)/chat/page.tsx`, `useEffect` for realtime  
The cleanup `return () => { supabase.removeChannel(channel); }` only runs when `activeJobId` or `isGenerating` changes. If the component unmounts while generating, the channel is cleaned up. But if `isGenerating` is set to `false` (in the `finally` block) before the Supabase `stage: "done"` UPDATE arrives, the subscription is torn down early and the final stage label update is missed. This is a minor race but causes the spinner to stay on "Storing drafts..." for the user.

### 5.4 `PostDetailDrawer.tsx` — `handleCancelPost` doesn't update local state on success
After `handleCancelPost` succeeds, the code calls `onUpdated()` and `setTimeout(onClose, 1400)`. But if the user rapidly closes and reopens the drawer, the detail still shows `status: "scheduled"` because `detail` state is not updated. Add `setDetail((p) => p ? {...p, status: 'cancelled', scheduled_at: null} : p)`.

### 5.5 Worker: No request timeout on LLM calls
**Files:** `worker/adapters/groq.py`, `worker/adapters/gemini.py`  
Neither adapter sets a timeout. A hung LLM call will block the worker indefinitely (Fly.io has a 60s HTTP timeout, but the worker itself has no guard). Add `timeout=30` to Groq and a deadline to Gemini.

### 5.6 Worker: `upload.to_cloudinary` called with `sync` SDK in async context
**File:** `worker/pipeline/upload.py`  
```python
r = cloudinary.uploader.upload(url, ...)
```
`cloudinary.uploader.upload` is **synchronous**. It's called inside an `async def` function but without `asyncio.to_thread`. This **blocks the event loop** for every image upload, degrading all concurrent requests.

**Fix:**
```python
import asyncio
r = await asyncio.to_thread(cloudinary.uploader.upload, url, folder=..., resource_type="auto")
```

---

## 6. Performance Concerns

### 6.1 `dashboard/page.tsx` — Two separate `fetch` calls on mount, no loading skeleton correlation
The dashboard makes `/api/metrics` and `/api/queue` concurrently (via `Promise.all`) — this is correct. But both API routes do independent Supabase queries without any connection pooling hint. At scale, add `?limit=20` to metrics and queue fetches.

### 6.2 `getBrandConfig` called on EVERY server-rendered page
See 4.8. At 2 DB round trips per page load, a user navigating between `/dashboard`, `/queue`, and `/settings` makes 6 extra queries. Cache in a `headers()` request-scoped store or move to middleware.

### 6.3 `posting-schedules.ts` — `nextSlots` computes in app code, not DB
**File:** `web/lib/db/posting-schedules.ts`  
`getNextSlotsForWorkspace` fetches all schedule rows then computes next slots in JavaScript. This is fine for < 100 slots, but the computation involves `Intl.DateTimeFormat` calls in a loop. For production, consider computing this at write time (cache the next 5 slots on the schedule row).

### 6.4 `VariantCard.tsx` — quick action chips each trigger a full regeneration + snapshot
Each click on "Shorter", "Longer", etc. in the Refine panel calls `handleQuickAction` → `handleRegenerate` → two `snapshotVariantBody` DB calls + a worker HTTP call. If a user clicks multiple chips rapidly (before the first returns), multiple worker calls fire in parallel. Add a debounce or disable all chips while any regen is in progress (currently only the text input is disabled via `regenerating` state, but `handleQuickAction` calls `handleRegenerate` directly).

Looking at the code: `disabled={regenerating}` IS on the buttons. This is fine. ✓

---

## 7. Type Safety Gaps

### 7.1 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` used 12+ times
Multiple files use `any` casts for Supabase join results. While understandable (Supabase join types are complex), these are real type holes. At minimum, define inline types for the join shapes rather than casting to `any`.

### 7.2 `SocialConnectionRow` cast in `token-expiry-check` route
**File:** `web/app/api/cron/token-expiry-check/route.ts`  
```ts
const connections = (expiring ?? []) as SocialConnectionRow[];
```
This cast bypasses the type checker. If the query returns unexpected null fields, downstream `readSecret(admin, connection.access_token_vault_id)` will throw at runtime.

### 7.3 `PostVariantRow` cast in `publish-due` cron
**File:** `web/app/api/cron/publish-due/route.ts`  
```ts
const claimed = ((claimedRows as unknown) as PostVariantRow[]) ?? [];
```
Double cast via `unknown` to escape the type system entirely. The RPC return type should be typed properly.

### 7.4 Worker: `voice_profile.py` `ToneProfile` field aliasing causes `model_dump` inconsistency
**File:** `worker/pipeline/voice_profile.py`  
When `render_system_prompt` accesses `profile.tone.tone_register` but the DB stores the profile as `{ "tone": { "register": "..." } }`, rehydrating from the DB into a `VoiceProfile` would fail unless you pass `by_alias=True` to the constructor. This is a latent bug if you ever re-render prompts from stored profiles.

---

## 8. Test Coverage Gaps

### 8.1 No tests for Next.js API routes
All the test files in `web/tests/` are either type-level tests or pure function tests. There are zero integration tests for the API routes (auth, publish, schedule, etc.). At minimum, add tests for:
- `POST /api/ingest` — happy path + rate limit
- `POST /api/posts/:id/publish` — idempotency guard
- `POST /api/posts/:id/schedule` — past date rejection

### 8.2 No test for `auth.py` HMAC verification
**File:** `worker/auth.py`  
The HMAC auth is the security gate for all worker endpoints. There are no tests for it (valid signature passes, invalid fails, missing header fails).

### 8.3 No test for `scrape.py` happy path
Only SSRF guard tests exist. No test for successful HTML fetch.

### 8.4 `schedule-utils.test.ts` missing DST edge cases
The test `converts non-UTC timezone slots` uses January (EST = UTC-5, no DST). No test covers the ambiguous fall-back hour or spring-forward skip.

### 8.5 No test for `upload.py` cloudinary upload
The Cloudinary upload is untested. A blocking sync call in async context (bug 5.6) would be caught here.

---

## 9. Recommended Fixes (copy-paste ready)

### Fix A: Rename middleware (CRITICAL)
```bash
# In web/ directory
mv proxy.ts middleware.ts
# Then edit the file:
# Change: export async function proxy(request: NextRequest) {
# To:     export default async function middleware(request: NextRequest) {
# Keep:   export const config = { ... }
```

### Fix B: Startup environment validation
Create `web/lib/env.ts`:
```ts
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WORKER_URL',
  'WORKER_SHARED_SECRET',
  'CRON_SECRET',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'LINKEDIN_REDIRECT_URI',
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
  'X_REDIRECT_URI',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```
Import this in `web/app/layout.tsx` (server component, runs at startup).

### Fix C: Fix cloudinary blocking call in worker
```python
# worker/pipeline/upload.py
import asyncio

async def to_cloudinary(media_urls: list[str], workspace_id: str) -> list[dict]:
    results = []
    for url in media_urls:
        try:
            r = await asyncio.to_thread(
                cloudinary.uploader.upload,
                url,
                folder=f"socialos/{workspace_id}/",
                resource_type="auto",
            )
            results.append({ ... })
        except Exception as e:
            log.warning("cloudinary_upload_failed", url=url, error=str(e))
    return results
```

### Fix D: Fix PATCH endpoint to enforce platform-specific char limits
```ts
// web/app/api/posts/[id]/route.ts
const CHAR_LIMITS: Record<string, number> = { linkedin: 3000, x: 280 };

export async function PATCH(request, { params }) {
  // ... auth checks ...
  const variant = await getPostVariant(id);
  const limit = CHAR_LIMITS[variant.platform] ?? 3000;
  const patchSchema = z.object({ body: z.string().min(1).max(limit) });
  // ... rest of handler
}
```

### Fix E: Fix missing revision_number in revert response
```ts
// web/app/api/posts/[id]/revisions/route.ts POST handler
const newRevision = await snapshotVariantBody({
  variantId: variant.id,
  workspaceId: workspace.workspace_id,
  body: variant.body,
  instruction: `reverted to revision ${target.revision_number}`,
});
await updatePostVariant(variant.id, { body: target.body });
return NextResponse.json({ 
  body: target.body, 
  revision_number: newRevision.revision_number 
});
```

### Fix F: Add global error boundary
Create `web/app/error.tsx`:
```tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-red-500 text-sm">Something went wrong.</p>
      <button onClick={reset} className="text-indigo-600 underline text-sm">Try again</button>
    </div>
  );
}
```

### Fix G: Remove duplicate ingestion stage update
```ts
// web/app/api/posts/route.ts — delete this line:
await updateIngestionJob(ingestion_job_id, { stage: "analyzing" });
// Keep only:
await updateIngestionJob(ingestion_job_id, { stage: "generating" });
```

### Fix H: Add LLM timeouts in worker
```python
# worker/adapters/groq.py
response = await client.chat.completions.create(
    model=settings.groq_model,
    messages=[...],
    max_tokens=1024,
    temperature=0.7,
    timeout=30,  # ADD THIS
)
```

---

## 10. Priority Matrix

| # | Issue | Severity | Effort | Fix First? |
|---|-------|----------|--------|-----------|
| 1.1 | Middleware not loaded (no auth protection) | 🔴 CRITICAL | 5 min | ✅ YES |
| 5.6 | Cloudinary blocks event loop | 🔴 CRITICAL | 10 min | ✅ YES |
| 2.1 | Revert returns no revision_number | 🟠 HIGH | 5 min | ✅ YES |
| 2.7 | PATCH allows 3000 chars on X posts | 🟠 HIGH | 15 min | ✅ YES |
| 4.4 | Double DB write on ingestion stage | 🟡 MED | 2 min | ✅ YES |
| 1.3 | Missing CRON_SECRET crashes silently | 🟠 HIGH | 20 min | ✅ YES |
| 5.1 | No error boundary | 🟠 HIGH | 10 min | ✅ YES |
| 1.6 | No rate limit on media uploads | 🟠 HIGH | 30 min | Soon |
| 2.9 | Race condition on revision numbers | 🟠 HIGH | 1 hr | Soon |
| 1.4 | SSRF redirect bypass | 🟠 HIGH | 45 min | Soon |
| 3.2 | next@16.2.4 doesn't exist | 🟡 MED | Verify | Soon |
| 3.3 | Zod v4 error.flatten() shape change | 🟡 MED | 30 min | Soon |
| 3.6 | tw-animate-css vs Tailwind v4 | 🟡 MED | 15 min | Soon |
| 4.1 | TopBar.tsx dead code | 🟢 LOW | 1 min | Cleanup |
| 4.7 | getVariantMediaRaw unused | 🟢 LOW | 1 min | Cleanup |
| 4.8 | 2 DB calls per page load for onboarding check | 🟡 MED | 2 hr | Backlog |
| 5.5 | No LLM call timeout | 🟡 MED | 10 min | Soon |
| 6.2 | getBrandConfig on every SSR page | 🟡 MED | 2 hr | Backlog |
| 8.1 | No API route tests | 🟡 MED | 4 hr | Backlog |

---

## Summary

**Must fix before going live (5 issues):**
1. Rename `proxy.ts` → `middleware.ts` and export as default — without this, **your app has zero auth protection**
2. Fix Cloudinary sync call blocking async event loop in worker
3. Fix missing `revision_number` in revert response
4. Add env var startup validation
5. Add global error boundary

**Fix within 1 week:**
- Platform-specific PATCH char limits
- Rate limiting on media upload
- Revision number race condition (DB-level sequence)
- SSRF redirect bypass
- LLM call timeouts

**Cleanup (non-blocking):**
- Delete `TopBar.tsx`, `getVariantMediaRaw`, remove unused `job_id` from worker generate route
- Fix double `updateIngestionJob` call
- Fix misleading comment in regenerate route
- Verify `next@16.2.4` resolves in your registry