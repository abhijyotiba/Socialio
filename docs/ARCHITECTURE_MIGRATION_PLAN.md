# Architecture Migration Plan — SocialOS
**Date:** 2026-05-09  
**Status:** Draft for review — do not implement until approved

---

## 1. What We Have Today

```
Browser (React)
    ↓ HTTPS
Next.js on Vercel — does EVERYTHING
    - Auth + session
    - All CRUD (personas, posts, campaigns, connections)
    - OAuth flows (LinkedIn, X)
    - Publishing to platforms
    - Cron job (publish-due every 5 min)
    ↓ HMAC-signed HTTPS
Python Worker on Fly.io — does TWO things only
    - Scrape URLs (Playwright)
    - Generate post text (Groq/Gemini LLM)
    ↓
Supabase — database + auth + vault
```

---

## 2. What Is Actually Wrong

### Problem 1 — Vercel Free Tier Breaks Core Features
| Feature | Vercel Free Limit | Impact |
|---|---|---|
| Cron frequency | Once per day minimum | Cannot publish on schedule — entire scheduling feature is broken |
| Function timeout | 10 seconds | AI generation takes 15-30s — calls will die mid-generation |
| Concurrent functions | Soft limits | 15 personas × 10,000 workspaces publishing simultaneously = chaos |

This is not a future scaling problem. **This breaks the product on day 1 for paying users.**

### Problem 2 — Publishing Queue Has No Retry Safety
The current cron loop runs inside a Vercel function. If it dies mid-run (timeout, crash, network blip), some posts are left in `status='publishing'` forever. The sweeper resets them after 10 minutes — but the sweeper is also inside the same fragile Vercel cron. A proper job queue handles retries, dead-letter queues, and backoff automatically.

### Problem 3 — No Separation for Heavy Work
Currently the logic for "decide what to publish" (scheduling logic, rate limits, persona checks) lives inside the cron route handler in Next.js. This is fine for 10 workspaces. For 1,000 workspaces with 15 personas each, a single Vercel function is doing 15,000 decisions in one shot.

### Problem 4 — Token Refresh Is Not Built
LinkedIn tokens expire in 60 days. X tokens expire in 2 hours (no refresh token). There is a `needs_reauth` flag in the schema but no cron that proactively refreshes tokens before they expire. At 15 personas per workspace, one expired token per persona per week is a constant stream of broken posts and user complaints.

### Problem 5 — Future AI Features Have Nowhere to Go
The plan includes image generation via LLM APIs. Image generation takes 10-60 seconds, produces large binary outputs, and may need queuing (e.g. "generate 15 images for 15 personas from one campaign"). There is no infrastructure for async jobs with progress tracking today.

---

## 3. The Target Architecture

```
Browser (React)
    ↓ HTTPS
Next.js on Vercel — ONLY what Vercel is great at
    - Auth + session management
    - CRUD APIs (personas, brand config, schedule slots)
    - OAuth flows (LinkedIn, X) — must stay here (redirect URLs)
    - Serve the UI
    ↓ HTTPS (auth-validated requests)
Python FastAPI Backend on Render/Cloud Run — the real backend
    - Publishing queue + scheduler
    - Campaign generation orchestration
    - Token refresh cron
    - Rate limit enforcement per persona
    - Future: image generation jobs
    - Future: analytics pull-back
    ↓ internal calls
Python Worker (existing, stays as-is)
    - Scrape URLs (Playwright)
    - Generate post text (LLM)
    - Generate images (future)
    ↓
Supabase — database + auth + vault (unchanged)
```

### Why Three Services, Not Two

| Service | Hosted On | Responsibility | Why Here |
|---|---|---|---|
| Next.js | Vercel free | UI + CRUD + OAuth | OAuth redirect URIs must be registered URLs. CRUD is trivial. Vercel is excellent for this. |
| Python Backend | Render / Cloud Run | Queue + scheduling + publishing + token refresh | Needs long-running processes, persistent connections, no timeout constraints. Python is better for orchestration. |
| Python Worker | Fly.io (existing) | Scraping + LLM calls | Already works. Stateless compute. No change needed. |

**OAuth cannot move to the Python backend.** LinkedIn and X require you to register exact callback URLs. Changing them requires re-registering the app and invalidating all existing tokens. This stays in Next.js.

---

## 4. What Moves Where — Exact Split

### Stays in Next.js (Vercel)
```
✅ Auth — /api/auth/** (Supabase session management)
✅ OAuth — /api/oauth/linkedin/** and /api/oauth/x/**
✅ Personas CRUD — /api/personas/**
✅ Brand config CRUD — /api/brand/**
✅ Schedule slots CRUD — /api/schedule-slots/**
✅ Connections read — /api/connections (read-only, for UI)
✅ Ingest — /api/ingest (thin proxy to worker, stays fast)
✅ Posts CRUD — /api/posts (create drafts, read variants)
✅ Campaigns CRUD — /api/campaigns (create, read status)
✅ Queue read — /api/queue (read scheduled posts for UI)
```

### Moves to Python Backend
```
🔁 Publishing cron — POST /internal/cron/publish-due
   Currently: Vercel cron (broken on free tier, 10s timeout)
   New: APScheduler in Python, runs every 5 min, no timeout limit

🔁 Token refresh cron — POST /internal/cron/refresh-tokens
   Currently: not built
   New: APScheduler, runs daily, refreshes LinkedIn tokens before expiry

🔁 Campaign generation orchestration
   Currently: POST /api/campaigns in Next.js calls worker in parallel
   New: Next.js creates the campaign row and enqueues a job.
        Python backend picks it up, calls worker per persona, updates DB.
        Removes the 15-second timeout risk from Next.js.

🔁 Post scheduling logic
   Currently: embedded in publish-due cron in Next.js
   New: Python backend owns the scheduler loop entirely

🔁 Rate limit enforcement
   Currently: persona_rate_limits table checked in SQL RPC
   New: still uses the same table, but the Python backend is the only
        writer — centralised, no race conditions across serverless functions
```

### Stays in Python Worker (unchanged)
```
✅ /ingest — Playwright scraping + Cloudinary upload
✅ /generate — LLM text generation
✅ /generate/regenerate — inline variant editing
✅ /voice/analyze — voice profile analysis
Future: /generate/image — image generation (new endpoint here)
```

---

## 5. How the New Request Flows Look

### User Generates a Campaign (Multi-Persona)
```
Before (today):
Browser → POST /api/campaigns (Next.js)
           → calls worker /generate × N personas in parallel (15s timeout)
           → writes variants to DB
           → returns campaign_id
Problem: if any persona takes > 15s, it fails. Vercel function holds
         open while all LLM calls run.

After:
Browser → POST /api/campaigns (Next.js)
           → creates campaign row (status='queued')
           → enqueues job to Python backend
           → returns campaign_id immediately (fast response)

Python backend picks up job:
           → calls worker /generate × N personas (no timeout pressure)
           → writes variants to DB
           → updates campaign status

Browser subscribes to Supabase Realtime on campaign row
           → sees status change to 'pending_approval'
           → shows variants (same as today, just async)
```

### Cron Publishing
```
Before (today):
Vercel Cron (once/day on free) → /api/cron/publish-due (10s timeout)
Problem: broken on free tier. Dies if publishing takes > 10s.

After:
APScheduler inside Python backend runs every 5 minutes
  → no external trigger needed
  → no timeout
  → retries failed publishes with exponential backoff
  → writes publish_attempts as audit log (same as today)
  → updates post_variants status (same as today)
```

### Token Refresh
```
New flow (does not exist today):
APScheduler runs daily at 3am:
  → queries social_connections WHERE token_expires_at < now() + 7 days
  → for LinkedIn: calls refresh token endpoint, updates Vault
  → for X: sets needs_reauth=true (X cannot refresh without re-auth)
  → logs to audit_events
  → (future) sends in-app notification if needs_reauth=true
```

---

## 6. Python Backend — What It Looks Like

```
python-backend/           ← new folder in repo root
├── main.py               ← FastAPI app
├── config.py             ← env vars
├── auth.py               ← validate requests from Next.js (shared secret)
├── scheduler.py          ← APScheduler setup (runs crons internally)
├── routes/
│   ├── jobs.py           ← POST /jobs/campaign, POST /jobs/publish
│   └── health.py         ← GET /health
├── jobs/
│   ├── campaign.py       ← campaign generation orchestration
│   ├── publish.py        ← publishing loop (moved from Next.js cron)
│   └── token_refresh.py  ← token refresh logic
├── adapters/
│   ├── linkedin.py       ← LinkedIn API calls (publish, refresh token)
│   ├── x.py              ← X API calls (publish)
│   └── vault.py          ← Supabase Vault decrypt (service key)
├── db/
│   └── client.py         ← Supabase Python client (service key)
├── tests/
├── pyproject.toml
├── Dockerfile
└── render.yaml           ← or fly.toml / cloud-run config
```

Key points:
- Uses Supabase **service key** (same as Next.js admin client) for DB writes
- Authenticates requests from Next.js via a shared secret header `X-Internal-Secret`
- APScheduler runs inside the same process — no Redis, no Celery, no extra services needed
- Stateless except for the DB — can be restarted at any time safely

---

## 7. What Does NOT Change

- **Database schema** — zero changes. Same tables, same RLS policies.
- **Supabase Vault** — token encryption stays the same.
- **Python Worker** — zero changes. It stays dumb compute.
- **Frontend** — zero changes visible to users.
- **OAuth flows** — stay in Next.js.
- **Supabase Realtime** — browser still subscribes to campaign/variant status updates.
- **`worker-client.ts`** — Next.js still calls the worker for ingest and regenerate.

The migration is purely a movement of scheduling + publishing + orchestration code from TypeScript (Next.js) into Python (new backend). The DB is the source of truth throughout.

---

## 8. Hosting — Free Tier Reality Check

### Render Free Tier
```
❌ Spins down after 15 min of inactivity → 30-60s cold start
✅ BUT: if you run APScheduler with a job every 5 min, it NEVER goes idle
        The cron jobs keep the process warm 24/7
✅ 512MB RAM is enough for orchestration (not scraping — that's Fly.io)
✅ 750 hours/month = 31 days of always-on (exactly enough)
Verdict: Free Render works IF the scheduler keeps it warm. ✅
```

### Google Cloud Run (Free Credit)
```
✅ Scales to zero (no cost when idle)
✅ No timeout on background jobs
✅ $300 free credit = months of operation
❌ Cold starts (mitigated with min-instances=1 — uses credit)
Verdict: Best option while credit lasts. Switch to Render after. ✅
```

### Fly.io (existing worker)
```
✅ Keep as-is for the Python worker
✅ Fly.io free tier does not spin down (unlike Render)
✅ No cold start problem
Verdict: Keep worker here. ✅
```

### GitHub Actions (for cron — free fallback)
```
✅ Free, 2000 minutes/month
✅ Cron syntax support
✅ Just calls POST /internal/cron/publish-due on the Python backend
Use as: backup trigger if APScheduler misses a beat
Verdict: Add as belt-and-suspenders, not primary scheduler. ✅
```

---

## 9. Migration Effort Estimate

| Task | Effort | Risk | Notes |
|---|---|---|---|
| Create python-backend folder + FastAPI skeleton | 0.5 days | Low | Boilerplate |
| Move publish-due cron to Python (jobs/publish.py) | 1 day | Medium | Most complex logic |
| Move campaign orchestration to Python (jobs/campaign.py) | 1 day | Medium | Parallel persona calls |
| Build token refresh job (jobs/token_refresh.py) | 0.5 days | Low | New code, not migration |
| Move LinkedIn/X adapters to Python | 1 day | Low | Port from TypeScript |
| Wire Vault decrypt in Python | 0.5 days | Low | Supabase Python client |
| Update Next.js: campaigns POST → enqueue only | 0.5 days | Low | Thin wrapper |
| Update Next.js: remove publish-due cron | 0.5 days | Low | Delete code |
| Deploy + test on Cloud Run | 1 day | Medium | Config, CORS, secrets |
| End-to-end testing (publish, campaign, token refresh) | 2 days | High | Most time here |
| **Total** | **~8-9 days** | | |

This is a clean migration, not a rewrite. The DB schema does not change. The risk is concentrated in testing the publish and campaign flows end-to-end.

---

## 10. What to Build in What Order

### Phase A — Fix the broken things first (Days 1-3)
1. Python backend skeleton + APScheduler + health check
2. Move `publish-due` logic to `jobs/publish.py`
3. Deploy to Cloud Run, point GitHub Actions at it as backup trigger
4. **Result:** Scheduling works reliably. No more Vercel cron dependency.

### Phase B — Move campaign orchestration (Days 4-5)
1. Move campaign generation to `jobs/campaign.py`
2. Next.js `/api/campaigns` becomes thin: create row + POST to backend
3. **Result:** Campaign generation no longer blocked by 15s Vercel timeout.

### Phase C — Token refresh (Day 6)
1. Build `jobs/token_refresh.py`
2. Daily cron, proactively refreshes LinkedIn tokens, flags X as needs_reauth
3. **Result:** Personas stop silently failing to publish due to expired tokens.

### Phase D — Image generation readiness (Future, not now)
1. Add `/generate/image` endpoint to Python Worker
2. Add `jobs/image_generation.py` to Python Backend
3. **Result:** Image generation can run as async jobs, no timeout pressure.

---

## 11. Decision Needed Before Starting

Before writing any code, confirm these three things:

1. **Hosting choice for python-backend:** Cloud Run (use free credit now, migrate later) or Render (simpler, free tier works if scheduler keeps it warm)?

2. **Migration approach:** Full migration first, then new features — or migrate piece by piece while continuing feature development?

3. **Supabase service key in Python backend:** The Python backend needs the service key to write to the DB (publish post_variants, write publish_attempts, update campaign status). This is the same key already used in Next.js admin client. Confirm this is acceptable.

---

## 12. Summary — What This Gives You

| Problem Today | After Migration |
|---|---|
| Cron broken on Vercel free tier | APScheduler in Python, runs every 5 min, always on |
| 10s timeout kills AI generation | Python backend has no timeout — jobs run until done |
| No token refresh | Daily cron, proactive refresh before expiry |
| Campaign generation can timeout | Async job, Next.js returns immediately, browser subscribes to status |
| Future image generation has nowhere to go | Python backend job queue, worker gets /generate/image endpoint |
| Single point of failure (Vercel) | Two separate services — if Vercel is down, queued jobs still process |
| Cannot scale publishing independently | Python backend scales separately from the UI |

The architecture after this migration is the correct foundation. Adding image generation, analytics, Telegram bots, or any AI feature on top of it is a matter of adding a new job type and a new worker endpoint — not rethinking the structure.
