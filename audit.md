EXECUTIVE SUMMARY
Was migration cleanup successful? Mostly — but it left a layer of dead code on top.

The architectural migration succeeded: all mutation routes I sampled (/api/posts/[id]/*, /api/schedule-slots/*, /api/media/upload, /api/oauth/*, /api/campaigns, /api/personas, /api/brand/*) are now thin proxies to the worker. env.ts requires only 4 vars — the Phase-3 endgame from your own analysis doc. lib/adapters/cloudinary.ts is deleted (git status confirms it). The web side has no Cloudinary, no admin Supabase client, no OAuth client secrets, no Playwright. That work is genuinely done.

But the lib/ layer and dependencies were never pruned to match. Several db helpers, an entire policy/ module, and ~25% of lib/db/* lines exist with no production callers — they're orphans from before the migration. The frontend size didn't shrink because the migration moved logic out but didn't delete the now-unused TS shells, and never went back to trim package.json. There are also two latent bugs from the migration: a deleted module is still type-referenced, and two functions (getAuthenticatedUser, the layout x-pathname check) silently fail because middleware was simplified without removing their callers.

This is a medium-effort cleanup, not a re-architecture. Most of it is rm and pnpm remove. The estimated total web/ source reduction is roughly 300–400 LOC and 2 production deps (@base-ui/react, tw-animate-css) plus moving 1 dep (shadcn) to dev.

Architecture quality post-migration: 7/10. The boundaries are clean. The leftover debt is hygiene, not structure.

CRITICAL ISSUES (high priority)
C1 — Broken type-only reference to deleted module
lib/db/media-assets.ts:26 and :54 declare:


adminClient: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>
The file @/lib/supabase/admin does not exist (verified: lib/supabase/ contains only browser.ts, client.ts, middleware.ts, server.ts). Why this compiles: those functions (getOrphanedMediaAssets, deleteMediaAssetsByIds) have zero call sites (grep-verified), so TS may be skipping their bodies, or the typeof+import lazy chain resolves to any. Either way it's a tripwire — the next tsc --noEmit after any TS upgrade will likely fail. Fix: delete both functions, see U1.

C2 — Silent dead branches from incomplete middleware refactor
lib/auth/auth-header.ts reads x-user-id/x-user-email from request headers — but middleware.ts never sets them. The if-branch (lines 10-20) never fires; the function is a more expensive alias for supabase.auth.getUser().

Same pattern in app/(app)/layout.tsx:22: reads x-pathname from middleware, falls back to "". The fallback makes onOnboarding = true for every path, so the onboarding redirect at lines 26-32 (which forces users without a brand_config into onboarding) never runs. New users may be able to navigate past onboarding into a half-configured app. This is a functional bug, not just dead code.

Fix one of two ways: either (a) add header-passing to middleware (the route handlers can use getAuthenticatedUser to skip a Supabase round-trip per request), or (b) delete auth-header.ts and fix app/(app)/layout.tsx to use createClient + getUser directly and pull pathname from a different source (you'll need a different mechanism — App Router Server Components don't get pathname natively).

C3 — Convention violation: route handlers query Supabase directly
CLAUDE.md §5: "Every Supabase call in the web app goes through a function in web/lib/db/. Route handlers do not call supabase.from(...) directly."

Grep supabase.from( in web/app/api returns 7 violations across 4 routes:

app/api/posts/[id]/route.ts:38 — content_items query
app/api/posts/[id]/route.ts:45 — ingestion_jobs query
app/api/posts/[id]/revisions/route.ts:31 — post_variant_revisions query
app/api/queue/route.ts:33 — post_variants query
app/api/metrics/route.ts:38 — post_variants + post_metrics join
app/api/profile/route.ts:28-43 — three sequential post_variants count queries
The profile route also runs 3 COUNT queries serially with await between each (line 27, 33, 39) instead of Promise.all — three full network round-trips for one render.

UNUSED DEPENDENCIES
Dep	Status	Evidence	Action
@base-ui/react ^1.4.1	Unused	Zero imports in app/ and components/ (grep verified).	pnpm remove @base-ui/react
tw-animate-css ^1.4.0	Unused	No @import "tw-animate-css" in globals.css; no TS imports. All animations are hand-rolled keyframes in globals.css lines 138-220.	pnpm remove tw-animate-css
shadcn ^4.4.0	Misplaced	This is the shadcn CLI for adding components. No source imports from "shadcn". It belongs in devDependencies.	Move to devDeps. Saves install size in prod.
class-variance-authority ^0.7.1	Used (1 file)	Only components/ui/button.tsx.	Keep.
tailwind-merge ^3.5.0	Used	lib/utils.ts:4 (cn()).	Keep.
clsx ^2.1.1	Used	lib/utils.ts via cn pipeline.	Keep.
lucide-react ^1.8.0	Used widely	22 files.	Keep — tree-shakes fine with named imports.
date-fns ^4.1.0	Used (5 files)	dashboard, queue, profile, modals.	Keep, but only format/formatDistanceToNow/isToday/isTomorrow used — tree-shakes well.
zod ^4.3.6	Underused	Only 3 routes (schedule-slots, profile PATCH, log-error). CLAUDE.md says "Zod schemas for every API request body."	Keep dep — but the convention is being violated everywhere.
supabase ^2.93.0	Used (CLI)	Used by scripts/gen-types.mjs. Already correctly in devDeps.	Keep.
Net dep reduction: 2 removals + 1 dev-move.

UNUSED FILES & DEAD EXPORTS
Confidence: HIGH — verified zero non-test callers
U1. app/api/cron/ — entire tree is empty
The directories exist (cleanup-orphaned-media/, publish-due/, pull-metrics/, token-expiry-check/) but contain zero files. The worker now owns cron. Delete app/api/cron/.

U2. lib/db/persona-rate-limits.ts — orphan, mutates DB from web
checkAndIncrementRateLimit is called only from lib/policy/rate-limits.ts::consumePublishBudget, which itself has no callers. The function does SELECT + INSERT + UPDATE on persona_rate_limits from the web side — exactly the kind of mutation the migration eliminated. Delete file.

U3. lib/policy/rate-limits.ts — orphan
Both exports (canGenerateCampaign, consumePublishBudget) only referenced by tests/policy.rate-limits.test.ts and the file itself. Campaign generation rate-limiting now lives in the worker. Delete file + test.

U4. lib/db/campaigns.ts::countRecentCampaigns — only called by the dead rate-limits.ts. Delete the function (keep the other two exports in the file: getCampaignWithPersonas, listCampaignsForWorkspace are used by app/(app)/campaigns/[id]/_components/CampaignDetail.tsx and /api/campaigns GET).

U5. lib/db/media-assets.ts::getOrphanedMediaAssets, ::deleteMediaAssetsByIds — zero callers. Both reference the deleted @/lib/supabase/admin (see C1). The cleanup-orphaned-media cron that called them is now in the worker. Delete both functions. Keep getMediaAssetsForJob (used by /api/media/route.ts).

U6. lib/db/posts.ts::updateContentItem, ::getContentItemWithVariants, ::listContentItemsForJob — zero callers (grep-verified). All three are mutation/multi-row helpers that the worker has equivalents for. The only used export is getPostVariant. Delete all three; consider collapsing the file to just getPostVariant or inlining it.

U7. lib/auth/persona-guard.ts::assertPersonasInWorkspace (plural) — only the test uses it. The singular assertPersonaInWorkspace is used by /api/metrics and /api/brand/config. Delete the plural variant + its test cases.

U8. public/ boilerplate SVGs — file.svg, globe.svg, next.svg, vercel.svg, window.svg are unreferenced create-next-app defaults (dated 2025-04-22, matching repo creation). Delete.

U9. lib/auth/auth-header.ts — see C2. Either delete entirely (only one caller, /api/metrics) or wire up the middleware header it expects.

Confidence: MEDIUM
U10. frontend_backend_analysis.md, Future improvements, improvement.md, audit.md, Local_Running.md, SOCIALOS_V2_PLAN.md at repo root — likely planning artifacts. Out of scope for web/ cleanup but worth a separate pass. The CLAUDE.md says canonical docs live in docs/.

BACKEND LOGIC STILL IN FRONTEND
After the migration, the surface area is small. What remains:

Genuine read-path business logic (acceptable per the architecture)
These are all GETs running under the user's JWT + RLS — exactly where CLAUDE.md says they belong:

getCampaignWithPersonas (lib/db/campaigns.ts:38) — 50-line deep PostgREST join with shape-massaging.
getLayoutConfig (lib/db/layout-config.ts:3) — nested workspace→personas→brand_configs join.
getNextSlotsForWorkspace → nextSlots (lib/db/schedule-utils.ts) — 147 lines of pure TS DST-aware schedule math. Could live in the worker (the worker already has equivalent Python code in worker/db/posting_schedules.py per git status), but having it here means the schedule list page doesn't need a worker round-trip. Judgment call.
Pure shape massaging that's fine here
app/api/connections/route.ts:42-54 — per-persona connection union with platform de-dup. Borderline business logic but small.
Mixed client/server confusion
app/api/connections/route.ts:42-45 — N+1: one getConnectionsForPersona per persona. For a workspace with 10 personas that's 10 sequential RLS queries. Should be a single IN (...) query or a view.
No leftover server-only secrets, no Cloudinary, no LinkedIn/X SDKs, no Playwright, no admin client. ✅
PERFORMANCE / BUNDLE ISSUES
P1 — All app pages are unnecessarily "use client"
Every page under app/(app)/ is a client component:

chat/page.tsx (555 lines — justified, it's a chat UI)
dashboard/page.tsx (useEffect + fetch('/api/profile') — could be a Server Component fetching directly under RLS)
queue/page.tsx (useEffect + fetch('/api/queue') — same)
profile/page.tsx (useEffect + fetch('/api/profile') — same)
onboarding/page.tsx
The pattern "use client" + useEffect + fetch('/api/X') causes:

Page ships as JS bundle (more KB, blocks hydration).
Two round-trips: HTML → JS → fetch → render. Server Components do it in one.
Skeleton loaders mask the latency but the latency is self-inflicted.
For dashboard/queue/profile, convert to async Server Components that call the lib/db/ helpers directly. The internal /api/queue, /api/metrics, /api/profile routes only exist for the client fetch — they can stay for any future external use but the page doesn't need them.

P2 — Chat polls AND subscribes
app/(app)/chat/page.tsx:240-264 polls /api/ingest/[job_id] every 1s, AND lines 101-129 opens a Supabase realtime channel on ingestion_jobs. The realtime subscription updates the same stage field the poller fetches. One of them is redundant — keep realtime, drop the poll.

P3 — Sequential queries in profile route
app/api/profile/route.ts:27-43 — three serial await count queries. Promise.all them (one of many easy wins).

P4 — getLayoutConfig runs on every (app) page render
app/(app)/layout.tsx:27 runs a 4-table nested join just to check defaultPersona.brand_configs[0] exists for an onboarding redirect — and (per C2) the redirect doesn't even fire. Either fix C2 and trim this query to SELECT 1 FROM brand_configs WHERE persona_id IN (SELECT id FROM personas WHERE workspace_id = ?), or delete the query entirely.

Why bundle didn't shrink after migration
The migration deleted server-side adapters and route logic — these were already tree-shaken out of the client bundle, so removing them changes nothing the browser sees. Bundle size is driven by what gets "use client", not what's in lib/. The frontend bundle stayed flat because:

Every page is still "use client".
@base-ui/react, tw-animate-css are still installed (whether they affect the bundle depends on whether tree-shaking caught them — but they shouldn't be there).
lucide-react and date-fns dominate; both tree-shake fine.
To actually shrink the user-facing bundle, P1 (kill unneeded "use client") is the single biggest lever.

ARCHITECTURE PROBLEMS
A1 — Two identical Supabase browser-client modules
lib/supabase/client.ts exports createClient (4 usages)
lib/supabase/browser.ts exports createBrowserSupabase (2 usages)
Bodies are byte-identical except the export name. Pick one (createBrowserSupabase is the more descriptive name and won't collide with lib/supabase/server.ts::createClient), update 4 callers, delete the other file.

A2 — Worker-client adapter sprawl
lib/worker-client.ts has 15 exports. Three of them (workerIngest, workerGetIngestion, workerCampaigns) duplicate what workerFetch does, because they predate workerFetch. They each re-implement the signing+fetch boilerplate inline. Refactor them to call workerFetch — would shrink the file from 257 LOC to ~150.

workerUploadMedia correctly stays separate (binary body, not JSON). workerLinkedinCallback and workerXCallback correctly use workerFetch.

A3 — Inconsistent auth pattern across routes
Some routes use supabase.auth.getUser(), some getSession(), one uses the broken getAuthenticatedUser(). The choice between getUser (validates JWT against Supabase) and getSession (cookie-only) has security implications. Pick one for read-only routes and one for mutation routes (worth: getUser for mutations, getSession is fine for cached reads). Document it in CLAUDE.md.

A4 — Zod usage convention not enforced
3/31 route handlers use Zod for request validation; CLAUDE.md says all should. Many POST/PATCH/PUT routes do ad-hoc if (!payload || typeof payload.body !== "string"). Either: (a) enforce Zod everywhere or (b) update CLAUDE.md to match reality ("Zod for routes with non-trivial bodies; ad-hoc for single-field shapes").

A5 — Netlify, not Vercel
netlify.toml shows the deploy target is Netlify. CLAUDE.md and the analysis doc say Vercel. Not a bug, but env-var planning and serverless-function timeouts differ. Reconcile the docs.

RECOMMENDED CLEANUP PLAN
Ordered by impact-per-effort.

Tier 1 — Pure deletion (1-2 hours, zero risk)
Delete app/api/cron/ (4 empty dirs).
Delete lib/policy/rate-limits.ts + tests/policy.rate-limits.test.ts.
Delete lib/db/persona-rate-limits.ts.
Delete countRecentCampaigns from lib/db/campaigns.ts.
Delete getOrphanedMediaAssets and deleteMediaAssetsByIds from lib/db/media-assets.ts (fixes C1).
Delete updateContentItem, getContentItemWithVariants, listContentItemsForJob from lib/db/posts.ts.
Delete assertPersonasInWorkspace from lib/auth/persona-guard.ts and the corresponding test cases.
Delete the 5 boilerplate SVGs from public/.
pnpm remove @base-ui/react tw-animate-css and move shadcn to devDependencies.
After this: roughly 300 LOC + 4 directory entries + 2 deps removed, no functional change.

Tier 2 — Fix the silent bugs (2-4 hours)
Decide on auth-header.ts + middleware (C2). Easiest: delete auth-header.ts, update /api/metrics to use supabase.auth.getUser(), and fix app/(app)/layout.tsx to drop the x-pathname check (use headers().get('x-invoke-path') or move the onboarding check into the onboarding-aware pages themselves).
Consolidate the two browser-client modules (A1) — pick one, delete the other, update callers.
Tier 3 — Tighten remaining mutations (2-4 hours)
Move the 7 supabase.from() calls out of route handlers into lib/db/ (C3). Either expose new helpers (getPostVariantWithSource, listRevisions, listScheduledVariants, listPublishedVariantsWithMetrics, getProfileStats) or move these reads to the worker too.
Promise.all the three counts in /api/profile (P3).
De-N+1 /api/connections (A.connections finding) — single query for all persona connections in the workspace.
Tier 4 — Bundle / perf win (4-8 hours)
Convert dashboard, queue, profile pages to async Server Components. Each becomes a server fetch + a small client island for interactive bits (the tabs, the modal). Biggest user-visible perf improvement.
Drop the chat poller, keep realtime (P2).
Refactor workerIngest/workerGetIngestion/workerCampaigns to use workerFetch (A2).
Tier 5 — Convention cleanup (ongoing)
Decide Zod policy and apply uniformly (A4).
Update CLAUDE.md to match reality (Netlify, not Vercel; current env-var minimum).
ESTIMATED IMPROVEMENT
Metric	Current	After Tier 1+2	After Tier 1+2+4
web/ source LOC (TS/TSX, excl. types.ts)	~3,400	~3,100	~2,900
lib/db/ LOC	612	~450	~450
Production deps	13	11	11
Empty/dead directories	4 (cron) + lib/publish + lib/security	0	0
Routes with direct supabase.from()	4	4	0 (Tier 3)
"use client" top-level pages	5/15	5/15	2/15
Bundle size (client JS)	baseline	~same	−15–25% (P1 is the lever)
Latent silent bugs (C2)	2	0	0
Why prior cleanup didn't move the needle: removing server adapters and route logic doesn't change what ships to browsers; only "use client" choices and package.json dependencies do. Tier 1 + Tier 4 together are what actually shrink the build.

CONFIDENCE NOTES
All "zero callers" claims were verified by grep across the entire web/ tree.
I could not measure actual .next output sizes — du was sandbox-blocked. Bundle estimates are based on what's likely tree-shaken vs. shipped given the import patterns observed.
I did not exhaustively read every component file (only Sidebar + chat). There may be additional unused or duplicate exports in app/(app)/**/_components/* that a follow-up ts-prune or knip run would surface.
The migration plan (docs/ARCHITECTURE_MIGRATION_PLAN.md) and session notes were not opened — they may explain why some of the "orphans" still exist (e.g. intentional rollback safety). Worth a 10-minute review before deleting Tier 1 items, though I think all of them are genuinely dead.
Audit complete. The single highest-leverage action is Tier 1 (deletion) followed by P1 (drop unneeded "use client") — together they address both the "size didn't reduce" complaint and the latent C1/C2 bugs.