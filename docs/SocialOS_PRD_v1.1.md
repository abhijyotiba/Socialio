# SocialOS — Product Requirements Document
**Version:** 1.1 — Revised after Architecture Review  
**Status:** Active  
**Author:** Internal Product Team  
**Last Updated:** April 2026  
**Changelog v1.1:**
- Scraping policy rewritten: LinkedIn content no longer scraped (legal risk)
- `posts` table split into `content_items` + `post_variants` (schema correctness)
- Cron publisher rewritten with `FOR UPDATE SKIP LOCKED` + visibility-timeout sweeper
- `workspace_members` table added for future-proof RLS
- `prompt_versions` table added for prompt versioning and diffing
- `publish_attempts` table added for idempotency and reconciliation
- Analytics upgraded: V1 now pulls engagement metrics for SocialOS-published posts
- Architecture updated: "Python island" pattern replaces full FastAPI split
- Pipeline updated: flat async functions replace LangGraph for V1
- X/Twitter API cost model added to open questions / risks
- LinkedIn token refresh strategy upgraded: silent refresh via refresh token
- Rate limit on `/ingest` tightened: 2/min, 50/day
- Upstash Redis scope clarified (rate limiting + cache only; not a job queue)
- Realtime subscription hardened: polling fallback when tab hidden
- Observability upgraded: SLI metrics and pipeline-stage timing added
- MCP integration promoted to V1 (Google Drive + Notion)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision & Goals](#3-product-vision--goals)
4. [Target Users & Personas](#4-target-users--personas)
5. [Scope — V1 vs Future](#5-scope--v1-vs-future)
6. [System Architecture Overview](#6-system-architecture-overview)
7. [Feature Specifications](#7-feature-specifications)
   - 7.1 Authentication & Onboarding
   - 7.2 Social Account Connection
   - 7.3 Content Ingestion Pipeline
   - 7.4 AI Content Generation
   - 7.5 Brand Design System
   - 7.6 Scheduler & Queue
   - 7.7 Publishing Engine
   - 7.8 Media Management
   - 7.9 Analytics Dashboard
8. [Data Architecture](#8-data-architecture)
9. [API Design](#9-api-design)
10. [Platform Modularity Design](#10-platform-modularity-design)
11. [Security & Compliance](#11-security--compliance)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Milestones & Delivery Plan](#13-milestones--delivery-plan)
14. [Open Questions & Risks](#14-open-questions--risks)

---

## 1. Executive Summary

**SocialOS** is a production-grade, multi-tenant social media content automation platform. Users connect their social accounts (LinkedIn, X/Twitter in V1), provide content sources — URLs, text prompts, MCP-connected documents — and the platform autonomously extracts context, scrapes media, generates brand-aligned post content using AI, and publishes or schedules it to the selected platforms.

The primary differentiator is a **chat-first ingestion interface** — users interact with the system in natural language ("write a post about the Notion doc I shared last week", "repurpose this article for both LinkedIn and X, keep the tone punchy"). This, combined with **first-class MCP source connectors** and a **versioned, diffable brand prompt system**, makes SocialOS the only tool in the space that treats the prompt itself as a managed asset rather than a settings field.

The platform is designed with hard modularity guarantees: adding a new social media platform, a new content source type, or a new AI provider requires a single new adapter module — not changes to core business logic.

The system is built on **Supabase** (auth + database), **Cloudinary** (media CDN), **Next.js** (frontend + CRUD API), and a **Python scrape-and-generate worker** — a focused architecture that keeps operational complexity low without sacrificing capability.

---

## 2. Problem Statement

### Current State (LinkedIn Repurposer)
The existing codebase is a single-user Flask application that:
- Scrapes one platform (LinkedIn) using Playwright
- Calls one LLM (Gemini/Groq) with a hardcoded prompt
- Stores a queue in a Google Sheet
- Publishes to a single LinkedIn company page
- Has no authentication, no multi-tenancy, no UI beyond a test page

### Problems to Solve

| Problem | Impact |
|---|---|
| Single-user — no login or account isolation | Cannot serve multiple clients |
| Single platform — LinkedIn only | Limits addressable market significantly |
| Google Sheet as database | Unreliable, no transactions, no access control |
| Hardcoded brand voice in prompt file | Cannot serve clients with different brand identities |
| No prompt versioning | When output quality changes, there is no way to diagnose or roll back |
| No media library | Attachments are ephemeral; lost on server restart |
| No engagement analytics | No feedback loop; users cannot learn what works |
| Scraper requires manual OAuth token refresh | Operational burden every 60 days |
| No approval workflow | Posts go live without human review option |
| `posts` schema conflates content with platform variant | One piece of content sent to two platforms creates unlinked duplicate rows |

---

## 3. Product Vision & Goals

### Vision
> The only social tool where you can say "write a post about the Gong call with Acme from yesterday" and it works. Chat-first ingestion, versioned brand prompts, and connections to wherever your content already lives.

### V1 Goals (90-day horizon)

- **G1:** Users can sign up, connect LinkedIn and X accounts via OAuth, and post to both from a single interface.
- **G2:** Users can submit a URL, raw text, or a Google Doc/Notion page as a content source; the platform extracts text and media automatically.
- **G3:** Users can define their brand voice and system prompt; every edit is versioned and diffable.
- **G4:** Every generated post variant is stored in Supabase with full metadata — content item, platform variant, prompt version used — before publication.
- **G5:** Users can schedule posts to specific dates and times per platform; the cron publisher guarantees no duplicate or missed publishes.
- **G6:** Published posts report back basic engagement metrics (impressions, likes, comments) pulled from platform APIs.
- **G7:** The codebase can accommodate a new social platform in under 4 hours of engineering work.

### Success Metrics

| Metric | V1 Target |
|---|---|
| Onboarding to first scheduled post | < 5 minutes |
| Content extraction success rate (non-LinkedIn URLs) | ≥ 90% |
| Scheduling accuracy SLI — `\|published_at − scheduled_at\| < 60s` | ≥ 98% of scheduled posts |
| AI generation satisfaction (posts published without user edit) | ≥ 70% |
| System uptime | 99.5% |
| Time from ingest to draft ready | < 20 seconds P95 |

---

## 4. Target Users & Personas

### Persona 1 — "The Solo Founder" *(V1 primary)*
- Runs a startup, posts on LinkedIn and X weekly
- Has a consistent brand voice but no dedicated marketing team
- Pain: spends 3–4 hours/week writing social content; constantly context-switching between tools
- Wants: "Point at what I'm reading, get a post I can actually use"
- Ceiling: $20–30/month if it saves them 3 hours/week

### Persona 2 — "The Content Manager" *(V1 secondary)*
- Works at a 20–100 person company managing 2–4 social channels
- Repurposes content from blog posts, internal docs, competitor analysis
- Pain: tool fragmentation — separate tools for scheduling, writing, tracking
- Wants: one place for the entire workflow; brand consistency across all output
- Values: audit trail, prompt versioning, queue visibility

### Persona 3 — "The Agency" *(V2)*
- Manages social for 5–20 clients, each with distinct brand identities
- Wants: client workspaces, isolated credentials, bulk scheduling
- Deferred until team workspace and approval workflow are ready

> **V1 focus:** Persona 1 (drives simplicity and chat UX) and Persona 2 (drives brand config depth and analytics). Features that serve only Persona 3 are deferred.

---

## 5. Scope — V1 vs Future

### V1 — In Scope

| Area | What's Included |
|---|---|
| Auth | Email/password + Google OAuth via Supabase Auth |
| Social Platforms | LinkedIn (personal profile only in V1), X/Twitter |
| Content Sources | Public URL scraping (non-LinkedIn), raw text/prompt, Google Docs via MCP, Notion via MCP |
| Media | Image and video extraction from URLs, Cloudinary storage |
| AI Generation | Two-pass (analyze + generate), versioned brand system prompt, platform-specific templates |
| Prompt System | Versioned brand prompt with diff, rollback, and per-post version tracking |
| Scheduling | Date/time picker, smart slot assignment, per-platform weekly schedule config |
| Queue Management | View, reschedule, cancel, duplicate queued post variants |
| Publishing | Idempotent publish with retry, visibility-timeout deadlock recovery |
| Analytics (V1) | Publish volume, success rate, on-time rate; engagement pull-back for published posts |
| Storage | Supabase (PostgreSQL) for all structured data |
| UI | Next.js — chat-style ingestion interface + queue side panel |

### V2 — Planned (Post V1)

- Instagram, Facebook Pages, Threads, Bluesky
- AI image generation for posts (DALL-E / Flux)
- Team workspaces and approval workflows
- Content calendar (Gantt/calendar UI)
- Multi-client (agency) workspace with isolated billing
- Bulk upload from CSV
- Zapier / Make.com webhook triggers
- Browser extension for one-click capture
- LinkedIn Company Page posting (requires LinkedIn Partner Program approval)

### Explicitly Out of Scope (V1)

- **LinkedIn post scraping** — prohibited by LinkedIn ToS; multi-tenant scraping at scale creates existential legal risk. LinkedIn content enters the system only when the user pastes text manually.
- Direct LinkedIn/X DM or comment management
- Paid ad campaign management
- Video editing or transcription

---

## 6. System Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    Next.js 15 (App Router)                 │
│  Chat Ingestion UI │ Queue Dashboard │ Brand Config        │
│                                                            │
│  Next.js API Routes handle:                                │
│  auth, CRUD (posts/brand/schedule), OAuth callbacks,       │
│  Supabase Realtime subscriptions, cron trigger endpoint    │
└──────────────────────────┬─────────────────────────────────┘
                           │ Internal HTTP (single call)
                ┌──────────▼──────────┐
                │  Python Worker      │
                │  (Scrape + Generate)│
                │                     │
                │  POST /process      │
                │  ├─ Playwright      │
                │  ├─ Cloudinary      │
                │  └─ LLM Pipeline    │
                └──────────┬──────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌────────▼──────┐  ┌───────▼──────┐
│  Supabase    │  │  Cloudinary   │  │  Upstash     │
│  (Postgres   │  │  (Media CDN)  │  │  Redis       │
│  + Auth +    │  │               │  │  (Rate limit │
│  Vault)      │  └───────────────┘  │  + Cache)    │
└──────────────┘                     └──────────────┘
```

### Key Architectural Decisions

**1. "Python Island" pattern over full FastAPI split**
Next.js 15 handles all auth, CRUD, OAuth callbacks, and the cron trigger endpoint. A single lightweight Python service exists *only* for the two things that need Python: Playwright scraping and LLM generation. It exposes one endpoint — `POST /process` — and returns structured JSON. This eliminates CORS configuration, duplicate JWT validation, duplicate Supabase client code, and two CI pipelines. Adding a feature does not require changes in both repos.

**2. Flat async pipeline over LangGraph**
The V1 ingestion pipeline is a straight-line sequence: scrape → upload → analyze → generate → store. There is no branching, no cyclic execution, and no stateful event loop. LangGraph adds significant debugging overhead and ecosystem churn risk without providing value for a linear pipeline. V1 uses six async Python functions in `pipeline.py`. Each function writes its stage output back to the `ingestion_jobs` table so retries resume from the last successful stage. LangGraph is reconsidered only if the pipeline develops genuine non-linear branching (multi-agent review loops, conditional re-generation, etc.).

**3. Supabase over Google Sheets**
PostgreSQL with built-in auth, row-level security, real-time subscriptions, and Vault-encrypted secret storage.

**4. `FOR UPDATE SKIP LOCKED` for cron claim**
Postgres-native distributed queue pattern. Replaces advisory locks and in-memory cache approach from the existing codebase. Correct by construction for multi-worker deployments.

**5. Cloudinary for all media**
New-origin URLs, transformation APIs for platform resizing, persistence across worker restarts. Already proven in the existing codebase.

**6. Upstash Redis — scoped to rate limiting and ingestion cache only**
Redis is not the job queue (Supabase polling with `FOR UPDATE SKIP LOCKED` handles that). Redis is used for: per-user rate limit counters on `/ingest`, ingestion cache keyed on URL hash (identical URL submitted twice returns cached extraction), and OAuth PKCE state parameters.

---

## 7. Feature Specifications

---

### 7.1 Authentication & Onboarding

#### 7.1.1 Registration & Login
- Email/password registration with email verification (Supabase Auth)
- "Continue with Google" OAuth
- Password reset via email
- Session management via Supabase JWT tokens
- Frontend middleware protects all routes — unauthenticated requests redirect to `/login`

#### 7.1.2 Onboarding Flow
After first login, the user is guided through a 3-step wizard before reaching the dashboard:

**Step 1 — Brand Setup** (required)
- Company/brand name
- Industry
- Website URL (optional, used for context enrichment)
- Tone selection: `Professional`, `Casual`, `Witty`, `Authoritative`, `Friendly` (multi-select)
- Wizard auto-generates a starter system prompt from these fields
- Advanced toggle: edit the raw system prompt directly

**Step 2 — Connect Accounts** (at least one required)
- LinkedIn OAuth flow (personal profile)
- X/Twitter OAuth 2.0 PKCE flow
- Visual status indicator per platform: `Connected` / `Not Connected`

**Step 3 — Test Post** (optional, skippable)
- Enter any public URL (blog, news article, YouTube)
- Preview generated content in chat interface
- "Skip for now" option

#### 7.1.3 User Profile
- Edit brand config anytime from Settings → Brand
- View prompt version history from Settings → Brand → Prompt History
- Manage connected accounts from Settings → Connections
- Danger zone: delete account (cascades delete all posts, connections, media)

---

### 7.2 Social Account Connection

#### 7.2.1 OAuth Flow Design
Each social platform requires OAuth. All credential exchange and storage happens exclusively server-side. Tokens never appear in HTTP responses, browser storage, or logs.

```
User clicks "Connect LinkedIn"
  → Next.js API route generates OAuth authorization URL with PKCE
  → State parameter stored in Upstash Redis (TTL 10 min)
  → User redirected to LinkedIn authorization page
  → LinkedIn redirects to /api/oauth/callback/linkedin
  → Backend validates state, exchanges code for access + refresh tokens
  → Tokens stored encrypted via Supabase Vault in social_connections table
  → UI updates to show "Connected" status (token metadata only — no raw tokens)
```

#### 7.2.2 Token Lifecycle Management

| Platform | Access Token TTL | Refresh Token TTL | Strategy |
|---|---|---|---|
| LinkedIn | 60 days | 365 days | Silent refresh 7 days before expiry via refresh token; re-auth prompt only if refresh fails |
| X/Twitter | Short-lived | Long-lived (OAuth 2.0 PKCE) | Silent refresh via refresh token flow |

**Silent Refresh Flow:**
- Daily cron job (`/api/cron/check-token-expiry`) runs at 02:00 UTC
- Queries `social_connections` for rows where `token_expires_at < now() + interval '7 days'`
- Calls `adapter.refresh_token()` for each — stores new tokens if successful
- If refresh fails: sends in-app banner + email notification; marks connection `needs_reauth = true`
- Re-auth from UI initiates a fresh OAuth flow without disrupting scheduled posts

**LinkedIn 365-day refresh token** replaces the V1.0 "7-day warning + manual reauth" approach. Users should rarely see a re-auth prompt.

#### 7.2.3 Supported Account Types (V1)

| Platform | Account Types |
|---|---|
| LinkedIn | Personal Profile only (Company Page deferred to V2 — requires LinkedIn Partner Program) |
| X/Twitter | Personal Account |

---

### 7.3 Content Ingestion Pipeline

This is the core of the product. The ingestion pipeline accepts a "source" from the user, extracts structured content from it, and feeds that into the AI generation pipeline.

#### 7.3.1 Chat Interface Design
The primary ingestion UI is a **chat-style interface** — not a form. This is SocialOS's primary differentiator over form-based competitors. The user types or pastes:
- A URL: `https://techcrunch.com/2026/04/...`
- A raw thought: `"We just closed our Series A. Write posts about why we built this company."`
- A natural language reference: `"Use the Notion doc about our Q2 strategy"`
- Multiple URLs: `"Repurpose these three articles for LinkedIn and X"`
- Follow-up edits in the same thread: `"Make the LinkedIn version more direct"`, `"Use the voice from my last post"`

Every interaction is a continuation. The chat thread is preserved per content item, allowing iterative refinement without re-ingestion.

```
User Input
    │
    ▼
Intent Classifier (LLM — fast, cheap model)
    │
    ├─► URL detected → dispatch to Python worker for scraping
    ├─► MCP reference detected → fetch via MCP connector
    ├─► Raw text/prompt → pass directly to generation pipeline
    ├─► Follow-up edit intent → apply to existing draft
    └─► Ambiguous → ask one clarifying question
```

#### 7.3.2 Source Types

**Type 1: Public URL (non-LinkedIn)**
- Playwright headless Chromium scraper
- Handles: blog articles, news articles, YouTube (title + description), X/Twitter threads, general web pages
- Extracts: title, main body text, OG description, images, videos
- Media uploaded to Cloudinary immediately after extraction
- Extracted content stored in `ingestion_jobs` table
- **LinkedIn URLs are not scraped.** If a LinkedIn URL is detected, the system responds: *"LinkedIn posts can't be scraped automatically. Please paste the text directly and I'll work with that."*
- Ingestion rate-limited: 2 requests/minute per user, 50 per day hard cap

**Type 2: Raw Text / Prompt**
- No scraping required
- Text passed directly to AI generation pipeline
- User's brand system prompt + current prompt version applied

**Type 3: MCP Source (V1 — Google Drive + Notion)**
- User has connected Google Drive or Notion via Settings → Integrations
- Natural language reference in chat triggers MCP fetch
- `"Use the doc titled Q2 Strategy"` → MCP tool call → document text extracted → passed to generation pipeline
- MCP OAuth handled per-user, stored in `mcp_connections` table

**Type 4: File Upload** (V1.1 — planned)
- PDF: text extracted via pdfminer
- Image: sent to vision model for description
- Video: audio transcribed via Whisper

#### 7.3.3 Ingestion Pipeline (Flat Async — Python Worker)

The ingestion pipeline runs as sequential async functions in `pipeline.py`. Each function writes its stage result back to `ingestion_jobs.stage` before proceeding. If the worker crashes mid-pipeline, a retry picks up from the last completed stage.

```python
async def run_pipeline(job_id: str, source_url: str, workspace_id: str):
    await set_stage(job_id, "scraping")
    raw = await scrape_url(source_url)              # Playwright

    await set_stage(job_id, "uploading_media")
    media = await upload_media_to_cloudinary(raw)   # Cloudinary

    await set_stage(job_id, "analyzing")
    analysis = await analyze_content(raw.text)      # LLM pass 1

    await set_stage(job_id, "generating")
    drafts = await generate_variants(analysis, workspace_id)  # LLM pass 2

    await set_stage(job_id, "storing")
    await store_content_item(job_id, raw, media, analysis, drafts)

    await set_stage(job_id, "done")
    return drafts
```

**Stage tracking** in `ingestion_jobs.stage` (enum: `pending | scraping | uploading_media | analyzing | generating | storing | done | failed`) gives full pipeline visibility in the queue dashboard and Sentry breadcrumbs.

#### 7.3.4 MCP Server Integration

MCP connectors are enabled per-user from Settings → Integrations. V1 ships with:

| Connector | Auth Method | What It Fetches |
|---|---|---|
| Google Drive | OAuth2 | Text content of Docs/Sheets by name or URL |
| Notion | OAuth2 | Page content by name or URL |

MCP tool calls are made server-side from the Next.js API routes. User MCP tokens stored encrypted in `mcp_connections` table. Responses feed directly into the generation pipeline, identical to Type 2 (raw text).

---

### 7.4 AI Content Generation

#### 7.4.1 Generation Architecture
Content generation uses a two-pass approach (unchanged from V1.0):

**Pass 1 — Context Analysis** (cheap, fast model — Groq Llama)
```
System: You are a content analyst.
User: Analyze this source content. Identify:
  - Core insight or key message
  - Target audience implied
  - Tone and register of the original
  - Facts, statistics, or quotes worth preserving
<source_content>...</source_content>
```

**Pass 2 — Post Generation** (primary model — Groq, Gemini fallback)
```
System: [User's brand system prompt @ current prompt version]
User: Generate posts for [platforms] based on this analysis:
<analysis>...</analysis>
<brand_config>
  name: Acme Corp
  industry: SaaS / B2B
  tone: Professional yet direct
</brand_config>
<platform_rules>
  [Loaded from prompts/platforms/{platform}.txt]
</platform_rules>
```

The `prompt_version_id` used in Pass 2 is recorded on every `post_variant` row — enabling "which prompt version wrote this post" queries and post-hoc quality analysis.

#### 7.4.2 Platform-Specific Generation

| Platform | Max Length | Format Rules | Template File |
|---|---|---|---|
| LinkedIn | 3,000 chars | Line breaks, 3–5 hashtags | `prompts/platforms/linkedin.txt` |
| X/Twitter | 280 chars | Concise, punchy, 1–2 hashtags | `prompts/platforms/x_twitter.txt` |
| X Thread | 280 × N | Sequential numbered tweets | `prompts/platforms/x_thread.txt` |

One ingestion job can generate variants for multiple platforms simultaneously. Each variant is stored as a separate `post_variants` row linked to the same `content_item`.

#### 7.4.3 Brand System Prompt — Versioned
The system prompt is the most important field in the system. It is now a versioned asset, not a text column.

Every time a user edits their system prompt:
1. A new row is written to `prompt_versions` with an incremented `version` integer
2. `brand_configs.active_prompt_version_id` is updated
3. The previous version remains in history
4. Users can view a diff of any two versions
5. Users can roll back to any previous version with one click
6. The UI shows: *"Your last 12 posts used prompt v3. You edited to v4 on April 15. Post performance since edit: +12% avg engagement."* (V1.1 — requires analytics pull-back to be live first)

#### 7.4.4 LLM Provider Configuration

| Provider | Default Use | Fallback |
|---|---|---|
| Groq (Llama 3.3 70B) | Pass 1 analysis + Pass 2 generation | Primary |
| Gemini 2.5 Flash | High quality fallback | Yes, automatic if Groq rate-limited |
| OpenAI GPT-4o | Not in V1 (added if user brings API key in V1.1) | — |

Provider fallback is handled in a single `llm_call()` function. All callers use this function — there is no provider-specific code outside it.

---

### 7.5 Brand Design System

#### 7.5.1 Brand Profile Fields

| Field | Type | Used In |
|---|---|---|
| Brand Name | text | System prompt, post attribution |
| Industry | text | System prompt context |
| Website URL | url | Context enrichment during analysis |
| Tone Tags | multi-select | Starter prompt generation |
| Active System Prompt | FK → `prompt_versions` | AI pipeline — Pass 2 |
| Forbidden Phrases | text[] | Post-generation filter |
| Hashtag Library | text[] | Auto-appended to posts per platform |
| Platform-specific overrides | per-platform text | LinkedIn prompt addendum vs X addendum |

#### 7.5.2 Prompt Template System
Users can save named prompt templates (e.g., "Product Launches", "Thought Leadership", "Case Studies") that extend the base brand prompt. Selecting a template during post creation prepends it to the base prompt for that generation only. All templates are versioned independently.

#### 7.5.3 Forbidden Phrase Filter
After generation, a lightweight post-processing step scans the output against the user's forbidden phrase list. The UI highlights any matches in yellow before the user approves the post. The user can override and publish anyway — the flag is advisory, not blocking.

#### 7.5.4 Prompt Versioning UI
Located in Settings → Brand → Prompt History:
- Version list with timestamp, word count delta, and author
- Side-by-side diff view for any two versions
- "Restore this version" button
- Per-version annotation field (users can note "switched to more direct tone for April campaign")

---

### 7.6 Scheduler & Queue

#### 7.6.1 Scheduling Interface
The scheduler is integrated into the post creation chat flow. After AI generates drafts:

1. User reviews each platform variant in the chat thread
2. User can inline-edit any variant
3. User selects timing (applies to all selected platforms, or individually):
   - **Publish Now** — immediate publication
   - **Smart Schedule** — system picks next optimal slot from posting schedule config
   - **Custom Date/Time** — datetime picker per platform

#### 7.6.2 Posting Schedule Config
Users define a weekly posting schedule per platform. Stored in `posting_schedules` table.

```json
{
  "platform": "linkedin",
  "timezone": "Asia/Kolkata",
  "slots": {
    "monday":    { "times": ["09:00", "13:00"], "max_posts": 2 },
    "tuesday":   { "times": ["10:00", "14:00"], "max_posts": 2 },
    "wednesday": { "times": ["09:00", "13:00"], "max_posts": 2 },
    "thursday":  { "times": ["10:00", "14:00"], "max_posts": 2 },
    "friday":    { "times": ["09:00"],           "max_posts": 1 },
    "saturday":  { "times": [],                  "max_posts": 0 },
    "sunday":    { "times": [],                  "max_posts": 0 }
  }
}
```

#### 7.6.3 Slot Assignment Logic
When "Smart Schedule" is selected:
- Query `post_variants` for already-scheduled variants on each candidate slot for this platform
- Apply a 2-hour minimum buffer from current time
- Return the first unbooked slot in the next 14 days
- Slot assignment is an atomic `UPDATE ... FOR UPDATE SKIP LOCKED` operation — concurrent requests cannot assign the same slot

#### 7.6.4 Queue Dashboard
The queue dashboard is a side panel in the chat UI showing all `post_variants` in the pipeline:

| Column | Description |
|---|---|
| Status | DRAFT / SCHEDULED / PUBLISHING / PUBLISHED / FAILED |
| Platform | Icon per platform |
| Scheduled Time | In user's timezone |
| Content Preview | First 80 chars of `final_text` or `generated_text` |
| Prompt Version | e.g., "v4" — links to prompt history |
| Media | Thumbnail if attached |
| Actions | Edit / Reschedule / Cancel / Duplicate |

Filters: by platform, by status, by date range.

#### 7.6.5 Cron Publisher

**Cron frequency:** every 5 minutes via Vercel Cron (V1) hitting `POST /api/cron/publish-scheduled`.

**Claim query — using `FOR UPDATE SKIP LOCKED`:**
```sql
UPDATE post_variants
SET status = 'publishing',
    claimed_at = now(),
    worker_id  = $1
WHERE id IN (
  SELECT id FROM post_variants
  WHERE  status = 'scheduled'
    AND  scheduled_at <= now()
  ORDER BY scheduled_at
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
RETURNING id, content_item_id, platform, connection_id,
          final_text, generated_text, scheduled_at;
```

`FOR UPDATE SKIP LOCKED` is Postgres's native distributed queue primitive. Multiple cron workers running simultaneously each claim a non-overlapping batch. No advisory locks, no in-memory cache, no Redis coordination needed.

**Visibility-timeout sweeper:**
A second query in the same cron cycle resets stuck rows:
```sql
UPDATE post_variants
SET status = 'scheduled', claimed_at = NULL, worker_id = NULL
WHERE status = 'publishing'
  AND claimed_at < now() - interval '10 minutes';
```
If a worker claims a row and crashes before completing, this sweeper releases it after 10 minutes so the next cron cycle retries it.

**Full cron cycle:**
1. Run visibility-timeout sweeper
2. Claim up to 10 due rows with `FOR UPDATE SKIP LOCKED`
3. For each claimed row:
   a. Write `publish_attempts` row (idempotency key = `post_variant_id`)
   b. Download media from Cloudinary to temp files (streamed, not fully buffered for video)
   c. Call `adapter.publish(request)`
   d. On success: update `status = published`, store `platform_post_id`, `platform_post_url`, `published_at`
   e. On failure: classify error, update `status = failed` or `status = scheduled` (retry), increment `retry_count`, store `error_code` enum
   f. Clean up temp files in `finally` block
4. Return summary JSON: `{ published, failed, retried, skipped }`

**Retry policy:**

| Retry # | Delay | Condition |
|---|---|---|
| 1 | 5 min | Transient (429, 5xx, timeout) |
| 2 | 15 min | Transient |
| 3 | 60 min | Transient |
| Terminal | — | Non-retryable (401, content policy, invalid media) |

After 3 failed retries: `status = failed`, in-app notification sent to user with `error_code` enum translated to a human-readable message (not raw API error text).

---

### 7.7 Publishing Engine

#### 7.7.1 Platform Adapter Interface
Every social platform is a **Platform Adapter** — a class implementing a standard interface. Adding a new platform = one new file + one registry entry.

```python
class PlatformAdapter(ABC):
    platform_id: str          # "linkedin", "x_twitter"
    display_name: str         # "LinkedIn", "X / Twitter"
    supported_media: list     # ["image", "video", "gif"]
    max_text_length: int
    max_images: int
    max_video_size_mb: int

    @abstractmethod
    def validate_token(self, connection: SocialConnection) -> TokenStatus: ...

    @abstractmethod
    def upload_media(self, file_path: str, media_type: str) -> str:
        """Returns platform media asset ID/URN"""
        ...

    @abstractmethod
    def publish(self, request: PublishRequest) -> PublishResult:
        """Creates the post. Returns post URL and platform post ID."""
        ...

    @abstractmethod
    def refresh_token(self, connection: SocialConnection) -> SocialConnection: ...

    @abstractmethod
    def get_post_metrics(self, platform_post_id: str,
                         connection: SocialConnection) -> PostMetrics:
        """Pulls impressions, likes, comments for a published post."""
        ...
```

#### 7.7.2 Publishing Request/Response Models

```python
@dataclass
class PublishRequest:
    post_variant_id: str       # Supabase post_variants.id
    idempotency_key: str       # = post_variant_id; sent to platform if supported
    workspace_id: str
    platform: str
    text: str
    image_paths: list[str]     # Local temp paths
    video_paths: list[str]
    connection: SocialConnection

@dataclass
class PublishResult:
    success: bool
    platform_post_id: str
    platform_post_url: str
    error: str | None
    error_code: str | None     # Machine-readable enum: TOKEN_EXPIRED, RATE_LIMITED,
                               # CONTENT_POLICY, INVALID_MEDIA, SERVER_ERROR, UNKNOWN

@dataclass
class PostMetrics:
    platform_post_id: str
    impressions: int | None
    likes: int | None
    comments: int | None
    shares: int | None
    fetched_at: datetime
```

#### 7.7.3 Idempotency on Publish
Double-publishing is the worst failure mode for a scheduling tool (user trust is immediately broken).

**Strategy:**
1. Before each publish attempt, write a `publish_attempts` row with `idempotency_key = post_variant_id` and `status = attempting`
2. Send `idempotency_key` to platforms that support it: LinkedIn accepts `X-RestLi-Request-Id`; X does not
3. For X: before publishing, query X for the last 5 posts from this account within the last 10 minutes. If a post with matching text is found, treat as success and skip re-publish
4. On success: update `publish_attempts.status = success`, store `platform_post_id`
5. If a `publish_attempts` row with the same `idempotency_key` and `status = success` already exists when the cron runs, skip publish (deduplication guard)

#### 7.7.4 Media Streaming for Large Files
Video files (up to 200MB LinkedIn / 512MB X) must not be fully buffered into memory on the API server.

**Implementation:**
- Stream directly from Cloudinary URL into the platform's upload endpoint in chunks
- Both LinkedIn's `PUT` to upload URL and X's chunked upload support streaming
- Python `httpx` async streaming client used for all media uploads
- Hard size-check guard before streaming: if `media_asset.bytes > platform_max_bytes`, mark the variant `FAILED` immediately with `error_code = INVALID_MEDIA` rather than attempting a 500MB download that will fail

#### 7.7.5 Retry & Error Classification

| Error Type | Error Code | Action |
|---|---|---|
| Rate limited (429) | `RATE_LIMITED` | Retry with backoff (up to 3x) |
| Token expired (401) | `TOKEN_EXPIRED` | Notify user, halt, do not retry |
| Invalid media | `INVALID_MEDIA` | Notify user, mark FAILED |
| Network timeout | `TIMEOUT` | Retry up to 3x |
| Platform server error (5xx) | `SERVER_ERROR` | Retry with exponential backoff |
| Content policy violation | `CONTENT_POLICY` | Notify user, mark FAILED |

---

### 7.8 Media Management

#### 7.8.1 Media Ingestion
When a source URL is scraped:
1. Images and videos identified by the scraper
2. Each file streamed from source URL → Cloudinary upload (no intermediate local buffering for images; temp file for videos with size guard)
3. Cloudinary permanent URL + `public_id` stored in `media_assets` table under `socialos/{workspace_id}/{content_item_id}/`
4. `post_media` join row created linking the asset to the content item

#### 7.8.2 Media Library
Users have a personal media library — all assets ever ingested into their workspace, searchable by filename, content item ID, or tag. Enables reuse of assets across posts without re-uploading.

#### 7.8.3 Platform Media Requirements

| Platform | Requirement | Enforced By |
|---|---|---|
| LinkedIn images | < 5MB, JPG/PNG | Pre-publish size check + Cloudinary transform |
| X/Twitter images | < 5MB, JPG/PNG/GIF/WEBP | Pre-publish size check + Cloudinary transform |
| LinkedIn video | < 200MB, MP4 | `media_assets.bytes` guard before publish |
| X/Twitter video | < 512MB, MP4 | `media_assets.bytes` guard before publish |

Cloudinary URL transformation parameters auto-resize images to platform specs without a re-upload. Video size is validated from the stored `bytes` field before any download is attempted.

---

### 7.9 Analytics Dashboard

#### 7.9.1 V1 Analytics — Two Tiers

**Tier 1 — Internal metrics (no platform API required):**
- Total posts published this week / month
- Posts per platform breakdown
- Posts by status (Scheduled / Published / Failed)
- Failure rate and most common error codes
- **On-time publish rate SLI** — `|published_at − scheduled_at| < 60s` as a percentage
- **Pipeline stage timing** — median and P95 time per stage (scraping, analyzing, generating) broken down by day

**Tier 2 — Engagement metrics (platform API pull-back):**
For every post SocialOS publishes, a background job fetches engagement 24 hours post-publish and stores in `post_metrics`:
- LinkedIn: impressions, reactions, comments, shares via `/v2/socialActions/{urn}` 
- X/Twitter: impressions, likes, retweets, replies via `/2/tweets/{id}`

This is not scraping — these are standard API calls for *your own posts* that are included in the free/basic API tier for both platforms. No additional scopes required beyond the posting scope.

**Metrics displayed per post variant in the queue dashboard:**
- Impressions / Likes / Comments (shown 24h+ after publish)
- "Top performing post this week" card on dashboard homepage

#### 7.9.2 What V2 Adds
- Best performing time slot heatmap
- Content type performance comparison (text-only vs image vs video)
- Prompt version performance correlation ("v4 outperformed v3 by 23% avg engagement")
- Bulk export to CSV

---

## 8. Data Architecture

### 8.1 Supabase Schema

#### `profiles`
```sql
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

#### `workspaces`
```sql
CREATE TABLE workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

#### `workspace_members`
```sql
-- Exists in V1 with a single owner row per workspace.
-- Enables team workspace in V2 without a migration.
CREATE TABLE workspace_members (
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'owner',  -- owner | admin | editor | viewer
  joined_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
```

All RLS policies reference `workspace_members`, not `workspaces.owner_id`:
```sql
-- Pattern used on ALL tables with workspace_id
CREATE POLICY "workspace_member_isolation" ON content_items
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()
  ));
```

#### `brand_configs`
```sql
CREATE TABLE brand_configs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_name               TEXT NOT NULL,
  industry                 TEXT,
  website_url              TEXT,
  tone_tags                TEXT[],
  forbidden_phrases        TEXT[],
  hashtag_library          TEXT[],
  active_prompt_version_id UUID,          -- FK set after first prompt_versions row
  updated_at               TIMESTAMPTZ DEFAULT now()
);
```

#### `prompt_versions`
```sql
-- Every edit to the system prompt creates a new row. Never updated in place.
CREATE TABLE prompt_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_config_id UUID REFERENCES brand_configs(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  prompt_text     TEXT NOT NULL,
  notes           TEXT,                   -- User-written annotation (optional)
  created_at      TIMESTAMPTZ DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  UNIQUE(brand_config_id, version)
);

-- After insert, update brand_configs.active_prompt_version_id
-- Done via trigger or application logic — trigger preferred for atomicity.
```

#### `prompt_templates`
```sql
CREATE TABLE prompt_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prompt_text   TEXT NOT NULL,
  is_default    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

#### `social_connections`
```sql
CREATE TABLE social_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  account_type      TEXT DEFAULT 'personal',
  account_id        TEXT NOT NULL,
  account_name      TEXT,
  account_avatar    TEXT,
  -- Tokens stored via Supabase Vault. access_token/refresh_token are vault secret IDs,
  -- not the raw token values.
  access_token_ref  TEXT,                 -- Vault secret reference
  refresh_token_ref TEXT,                 -- Vault secret reference
  token_expires_at  TIMESTAMPTZ,
  scopes            TEXT[],
  needs_reauth      BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  connected_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, platform, account_id)
);
```

#### `mcp_connections`
```sql
CREATE TABLE mcp_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  connector         TEXT NOT NULL,        -- 'google_drive', 'notion'
  access_token_ref  TEXT,                 -- Vault secret reference
  refresh_token_ref TEXT,
  token_expires_at  TIMESTAMPTZ,
  is_active         BOOLEAN DEFAULT true,
  connected_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, connector)
);
```

#### `ingestion_jobs`
```sql
CREATE TABLE ingestion_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id),
  source_type     TEXT NOT NULL,          -- 'url', 'text', 'mcp', 'file'
  source_url      TEXT,
  source_text     TEXT,
  extracted_title TEXT,
  extracted_text  TEXT,
  analysis_summary TEXT,                  -- Output of LLM Pass 1
  stage           TEXT DEFAULT 'pending', -- pending|scraping|uploading_media|
                                          -- analyzing|generating|storing|done|failed
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
```

#### `media_assets`
```sql
CREATE TABLE media_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID REFERENCES workspaces(id),
  ingestion_job_id UUID REFERENCES ingestion_jobs(id),
  cloudinary_url   TEXT NOT NULL,
  cloudinary_id    TEXT NOT NULL,
  resource_type    TEXT NOT NULL,         -- 'image', 'video'
  format           TEXT,
  bytes            BIGINT,
  width            INT,
  height           INT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

#### `content_items`
```sql
-- One logical "piece of content" regardless of how many platforms it's going to.
CREATE TABLE content_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID REFERENCES workspaces(id),
  ingestion_job_id UUID REFERENCES ingestion_jobs(id),
  source_text      TEXT,                  -- Original extracted/pasted text
  analysis_summary TEXT,                  -- LLM Pass 1 output stored here too
  prompt_version_id UUID REFERENCES prompt_versions(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

#### `post_variants`
```sql
-- One row per (content_item, platform). Replaces the old `posts` table.
CREATE TABLE post_variants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id    UUID REFERENCES content_items(id) ON DELETE CASCADE,
  workspace_id       UUID REFERENCES workspaces(id),  -- denormalised for RLS
  connection_id      UUID REFERENCES social_connections(id),
  platform           TEXT NOT NULL,
  generated_text     TEXT NOT NULL,
  final_text         TEXT,               -- NULL = use generated_text
  prompt_version_id  UUID REFERENCES prompt_versions(id),
  status             TEXT DEFAULT 'draft',
  -- draft | scheduled | publishing | published | failed | cancelled
  scheduled_at       TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  claimed_at         TIMESTAMPTZ,        -- Set during cron claim; cleared on success/fail
  worker_id          TEXT,               -- Cron worker ID that claimed this row
  platform_post_id   TEXT,
  platform_post_url  TEXT,
  error_message      TEXT,
  error_code         TEXT,               -- Machine-readable enum
  retry_count        INT DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
```

#### `post_media`
```sql
CREATE TABLE post_media (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
  post_variant_id UUID REFERENCES post_variants(id) ON DELETE CASCADE,
  media_asset_id  UUID REFERENCES media_assets(id),
  position        INT DEFAULT 0
);
```

#### `publish_attempts`
```sql
-- Audit log and idempotency guard for every publish attempt.
CREATE TABLE publish_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_variant_id UUID REFERENCES post_variants(id),
  idempotency_key TEXT NOT NULL,          -- = post_variant_id
  attempt_number  INT NOT NULL,
  status          TEXT NOT NULL,          -- attempting | success | failed
  platform_post_id TEXT,
  error_code      TEXT,
  error_detail    TEXT,
  attempted_at    TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE(idempotency_key, attempt_number)
);
```

#### `post_metrics`
```sql
-- Engagement data pulled from platform APIs 24h after publish.
CREATE TABLE post_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_variant_id  UUID REFERENCES post_variants(id),
  platform         TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  impressions      INT,
  likes            INT,
  comments         INT,
  shares           INT,
  fetched_at       TIMESTAMPTZ DEFAULT now()
);
```

#### `posting_schedules`
```sql
CREATE TABLE posting_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id),
  platform      TEXT NOT NULL,
  timezone      TEXT DEFAULT 'UTC',
  schedule_json JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, platform)
);
```

### 8.2 Row-Level Security (RLS)

All tables enforce RLS. All policies use the `workspace_members` pattern (not `workspaces.owner_id`) so V2 team access works without migration:

```sql
-- Template — applied to every table with workspace_id
CREATE POLICY "workspace_member_access" ON {table}
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()
  ));
```

**Service-role key usage rule:** The Python worker and cron functions use the Supabase service role key (which bypasses RLS). This key may only be imported in files under `worker/` and `api/cron/`. Any route handler in `api/` must use the anon key + JWT. This is enforced via ESLint custom rule and code review checklist. Violation = automatic PR rejection.

**Token vault access:** `social_connections.access_token_ref` and `refresh_token_ref` store Supabase Vault secret IDs, not token values. The application calls `vault.decryptSecret(ref)` server-side. Raw token values never appear in query results or API responses.

---

## 9. API Design

### 9.1 Architecture Split

| Layer | Technology | Handles |
|---|---|---|
| Frontend + CRUD API | Next.js 15 App Router | UI, auth, posts CRUD, OAuth callbacks, schedule config, cron trigger |
| Scrape + Generate Worker | Python (FastAPI, single route) | `POST /process` — scraping + Cloudinary + LLM pipeline |
| Database | Supabase | All structured data, RLS, Vault |

Next.js API routes call the Python worker for ingestion only. All other data operations go directly to Supabase from the Next.js server.

### 9.2 Next.js API Routes

#### Auth (Supabase Auth handles; Next.js middleware wraps)
```
POST   /api/auth/callback       → Supabase OAuth callback
GET    /api/auth/me
```

#### OAuth (Social platforms)
```
GET    /api/oauth/connect/[platform]     → Redirect to platform auth
GET    /api/oauth/callback/[platform]    → Token exchange (server-only)
DELETE /api/oauth/disconnect/[platform]
GET    /api/oauth/connections            → List connected accounts (metadata only)
```

#### Brand & Prompts
```
GET    /api/brand
PUT    /api/brand
GET    /api/brand/prompt-history         → All prompt_versions for workspace
POST   /api/brand/prompt-history         → Create new prompt version
GET    /api/brand/prompt-history/[v1]/diff/[v2]  → Diff two versions
POST   /api/brand/prompt-history/[id]/restore    → Set as active version
GET    /api/brand/templates
POST   /api/brand/templates
PUT    /api/brand/templates/[id]
DELETE /api/brand/templates/[id]
```

#### Ingestion
```
POST   /api/ingest
Body:  { source_type: "url"|"text"|"mcp", source_url?, source_text?,
         mcp_connector?, mcp_reference? }
Flow:  Next.js writes ingestion_jobs row → calls Python worker → streams status
       back via Supabase Realtime on ingestion_jobs.stage

GET    /api/ingest/[job_id]              → Poll job status
```

#### Content & Posts
```
GET    /api/content                      → List content_items
GET    /api/content/[id]                 → Content item + all variants
PUT    /api/content/[id]/variants/[vid]  → Edit variant text
POST   /api/content/[id]/variants/[vid]/publish
POST   /api/content/[id]/variants/[vid]/schedule
POST   /api/content/[id]/variants/[vid]/cancel
POST   /api/content/[id]/variants/[vid]/duplicate
DELETE /api/content/[id]
```

#### Schedule Config
```
GET    /api/schedule-config
PUT    /api/schedule-config/[platform]
GET    /api/schedule-config/[platform]/next-slot
```

#### Analytics
```
GET    /api/analytics/summary            → Publish counts, SLI metrics, stage timings
GET    /api/analytics/posts              → Per-post metrics (engagement)
```

#### Cron (protected by CRON_SECRET header)
```
POST   /api/cron/publish-scheduled       → Main publisher cron (every 5 min)
POST   /api/cron/check-token-expiry      → Silent refresh cron (daily)
POST   /api/cron/fetch-post-metrics      → Engagement pull-back cron (every 6 hr)
```

#### Media
```
GET    /api/media                        → Media library
DELETE /api/media/[id]
```

### 9.3 Python Worker API
```
POST   /process
Body:  {
  job_id: string,
  workspace_id: string,
  source_type: "url" | "text" | "mcp",
  source_url?: string,
  source_text?: string,
  platforms: string[],
  prompt_version_id: string
}
Response: {
  content_item_id: string,
  variants: [{ platform, generated_text, media_used }],
  stage_timings: { scraping_ms, uploading_ms, analyzing_ms, generating_ms }
}
```

### 9.4 Realtime Subscriptions
Supabase Realtime used for live queue updates. Subscription is active only when the queue dashboard tab is visible. When tab is hidden, the frontend falls back to polling every 15 seconds — prevents free-tier Realtime concurrency exhaustion.

```javascript
// Active subscription (tab visible)
const channel = supabase
  .channel('post-variants-updates')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'post_variants',
    filter: `workspace_id=eq.${workspaceId}`
  }, payload => { updateQueueUI(payload.new) })
  .subscribe()

// Polling fallback (tab hidden)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    channel.unsubscribe()
    startPolling(15000)
  } else {
    stopPolling()
    channel.subscribe()
  }
})
```

---

## 10. Platform Modularity Design

This is a first-class design requirement. Adding a new platform must require minimal changes and zero changes to core business logic.

### 10.1 What Changes Per Platform

| Component | What to Add | Where |
|---|---|---|
| OAuth flow | Client ID/Secret in env | Generic `/api/oauth/connect/[platform]` + `/callback/[platform]` routes; adapter handles platform-specific params |
| Adapter | New file implementing `PlatformAdapter` | `worker/adapters/{platform}.py` |
| Publish logic | Inside the adapter's `publish()` method | Same file |
| Metrics pull | Inside the adapter's `get_post_metrics()` method | Same file |
| Prompt addendum | Platform-specific formatting rules | `worker/prompts/platforms/{platform}.txt` |
| Media validators | Max size/format | Defined as class constants inside the adapter |
| Frontend | Platform icon + name | Add to `PLATFORMS_CONFIG` constant in `lib/platforms.ts` |
| Schedule support | Automatic — `posting_schedules.platform` is a text column | No code change |

### 10.2 Platform Registry

```python
# worker/adapters/__init__.py
from adapters.linkedin   import LinkedInAdapter
from adapters.x_twitter  import XTwitterAdapter

PLATFORM_REGISTRY: dict[str, type[PlatformAdapter]] = {
    "linkedin":  LinkedInAdapter,
    "x_twitter": XTwitterAdapter,
    # V2: "instagram": InstagramAdapter,
    # V2: "facebook":  FacebookAdapter,
    # V2: "threads":   ThreadsAdapter,
}

def get_adapter(platform: str) -> PlatformAdapter:
    cls = PLATFORM_REGISTRY.get(platform)
    if not cls:
        raise ValueError(f"Unknown platform: {platform}")
    return cls()
```

### 10.3 Adding a New Platform — Checklist

Example: adding Instagram in V2.
- [ ] Create `worker/adapters/instagram.py` implementing `PlatformAdapter`
- [ ] Add `"instagram": InstagramAdapter` to `PLATFORM_REGISTRY`
- [ ] Add `worker/prompts/platforms/instagram.txt`
- [ ] Add `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET` to env
- [ ] Add `"instagram"` to `lib/platforms.ts` `PLATFORMS_CONFIG`
- [ ] Write one integration test in `tests/adapters/test_instagram.py`

Total estimated engineering effort: **2–4 hours**.

---

## 11. Security & Compliance

### 11.1 Token Security
- OAuth tokens stored via **Supabase Vault** exclusively (resolved OQ-5: do not roll custom AES-256)
- `social_connections` table stores vault secret *references*, never raw token values
- Tokens never returned to the frontend in any API response — only metadata (expiry, scopes, account name)
- Tokens never appear in logs (log only `connection_id`)
- Token encryption key managed and rotated by Supabase Vault
- Service-role key restricted to `worker/` and `api/cron/` via ESLint rule

### 11.2 Scraping Policy (Updated)
- **LinkedIn posts are never scraped.** LinkedIn's ToS explicitly prohibits scraping. Multi-tenant scraping at scale risks app ban, which bricks all customers simultaneously.
- All other public URLs (blogs, news, YouTube, X threads, general web) are scraped via Playwright
- Rate limiting on ingestion: **2 requests/minute per user, 50/day hard cap** (tightened from original 10/min)
- URL allowlist: `linkedin.com` is blocked; all other HTTP/HTTPS URLs permitted subject to SSRF guard
- SSRF protection: DNS resolution checked against private IP ranges (RFC1918, loopback, link-local, AWS metadata endpoint `169.254.169.254`) using a server-side filter before any Playwright request
- User-Agent rotation on scraper requests

### 11.3 API Security
- All API routes require valid Supabase JWT except cron endpoints
- Cron endpoints require `X-Cron-Secret: ${CRON_SECRET}` header
- Rate limiting enforced via Upstash Redis on all `/api/ingest` calls
- Input sanitization: all user-provided text wrapped in XML delimiters before LLM injection (prevents prompt injection)
- OAuth PKCE state parameter stored in Upstash Redis with 10-minute TTL (prevents CSRF)

### 11.4 Data Privacy
- No user content retained by LLM providers beyond the API call (zero-data-retention agreements with Groq; Gemini Business tier)
- Cloudinary media scoped under `socialos/{workspace_id}/`
- Account deletion cascades: all `content_items`, `post_variants`, `media_assets`, `social_connections`, and Vault secrets deleted
- GDPR data export available on request (V1.1)

### 11.5 Secrets Management
```env
# App
NODE_ENV=production
PYTHON_WORKER_URL=https://worker.socialos.app
PYTHON_WORKER_SECRET=...      # Shared secret for Next.js → Python worker calls

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...      # Used only in worker/ and api/cron/

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...

# X/Twitter OAuth
X_TWITTER_CLIENT_ID=...
X_TWITTER_CLIENT_SECRET=...

# LLM Providers
GROQ_API_KEY=...
GEMINI_API_KEY=...

# Infrastructure
CRON_SECRET=...
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
SENTRY_DSN=...
```

---

## 12. Non-Functional Requirements

### 12.1 Performance

| Operation | Target P95 Latency |
|---|---|
| URL ingestion end-to-end (scrape + upload + analyze + generate) | < 20 seconds |
| AI content generation only (no scrape) | < 8 seconds |
| Post scheduling write (variant → Supabase) | < 1 second |
| Queue dashboard initial load | < 500ms |
| Cron cycle (claim + publish 10 posts) | < 60 seconds |
| Engagement metrics fetch (per post) | < 5 seconds |

### 12.2 Reliability

| Scenario | Behavior |
|---|---|
| Scraping fails (timeout, DOM change) | `ingestion_jobs.stage = failed`; error surfaced in chat UI |
| LinkedIn URL submitted | Friendly message asking user to paste text; no scrape attempted |
| LLM rate limited (Groq) | Automatic silent fallback to Gemini |
| Platform API down during publish | Post stays `SCHEDULED`; visibility-timeout sweeper retries next cycle |
| Cron worker crashes mid-publish | `claimed_at` timeout sweeper resets row after 10 min |
| Double-publish attempt | `publish_attempts` idempotency guard + `idempotency_key` to platform |
| Supabase outage | API returns 503; cron retries on recovery |
| Cloudinary upload fails | Ingestion continues text-only; user warned in chat |
| Video file exceeds platform limit | Variant marked FAILED immediately with `INVALID_MEDIA`; no download attempted |

### 12.3 Scalability
- Next.js on Vercel: serverless, auto-scales
- Python worker on Render (or Fly.io): max 2 concurrent Playwright sessions per instance; scale horizontally by adding instances
- Supabase: managed Postgres with PgBouncer connection pooling
- Cloudinary: CDN, inherently scalable
- Upstash Redis: serverless, auto-scales

### 12.4 Observability

**Structured logging:** All log lines include `workspace_id`, `content_item_id`, `post_variant_id`, `platform`, `stage`. JSON format, shipped to Sentry + Vercel Log Drain.

**Key dashboards to build in Week 1 of pipeline phase (not at launch):**

| Dashboard | Metric | Why |
|---|---|---|
| Pipeline stage timing | Median + P95 ms per stage per day | Shows exactly where slowness lives |
| On-time publish SLI | `\|published_at − scheduled_at\| < 60s` % | Core success metric from §3 |
| Cron health | Publish count / failure count / retry count per cycle | Detects worker crashes |
| Ingestion success rate | `done` / (`done` + `failed`) by source type | Flags scraper breakage |

**Error tracking:** Sentry on both Next.js and Python worker.

**Uptime monitoring:** Better Uptime pinging `/api/health` and `{python_worker}/health` every 1 minute.

---

## 13. Milestones & Delivery Plan

### Phase 0 — Foundation (Weeks 1–2)
- [ ] Supabase project: full schema migration (all tables in §8.1), RLS policies, Vault setup
- [ ] `workspace_members` seeded for all new users via auth trigger
- [ ] Next.js 15 scaffold with Supabase auth, middleware, and all CRUD routes stubbed
- [ ] Python worker scaffold: FastAPI single-route, Playwright install, health endpoint
- [ ] LinkedIn OAuth adapter (migrated from existing codebase)
- [ ] Vercel (frontend) + Render (Python worker) deployment pipelines
- [ ] **Pricing/unit economics model for X/Twitter** — model COGS at 10 posts/day/user and 30 posts/day/user; set pricing before Phase 3

### Phase 1 — Core Pipeline (Weeks 3–5)
- [ ] URL scraper (Playwright, all non-LinkedIn sources)
- [ ] Cloudinary media upload with streaming
- [ ] Flat async pipeline: `scrape → upload → analyze → generate → store`
- [ ] `ingestion_jobs.stage` tracking with per-stage timing logged
- [ ] `content_items` + `post_variants` storage
- [ ] Brand config CRUD including prompt versioning (create, list, diff, restore)
- [ ] Chat UI: URL/text input → streams pipeline progress → shows generated variants
- [ ] Pipeline stage timing dashboard

### Phase 2 — Scheduling & Publishing (Weeks 6–7)
- [ ] Scheduler UI: platform selector + timing options in chat thread
- [ ] Posting schedule config (per-platform weekly slots)
- [ ] Smart slot finder using `FOR UPDATE SKIP LOCKED`
- [ ] Cron publisher with `FOR UPDATE SKIP LOCKED` claim + visibility-timeout sweeper
- [ ] `publish_attempts` table + idempotency logic
- [ ] Retry classification (error_code enum)
- [ ] On-time publish SLI dashboard
- [ ] Queue dashboard side panel with Supabase Realtime + polling fallback
- [ ] In-app notification on post failure (with human-readable error_code)

### Phase 3 — X/Twitter + Engagement (Week 8)
- [ ] X/Twitter OAuth adapter
- [ ] X/Twitter post publisher (text + image) with idempotency best-effort
- [ ] X/Twitter thread generation
- [ ] Engagement metrics pull-back cron (24h post-publish)
- [ ] `post_metrics` populated; per-post engagement shown in queue dashboard
- [ ] Platform selector UI update

### Phase 3.5 — MCP Connectors (Week 9)
- [ ] Google Drive MCP connector (OAuth + document fetch)
- [ ] Notion MCP connector (OAuth + page fetch)
- [ ] Chat intent classifier handles MCP references
- [ ] Settings → Integrations UI

### Phase 4 — Polish & Launch (Week 10)
- [ ] Onboarding wizard (3-step: brand → connect → test post)
- [ ] Silent token refresh cron (`check-token-expiry`)
- [ ] Forbidden phrase filter UI
- [ ] Analytics summary page (Tier 1 + Tier 2 metrics)
- [ ] End-to-end tests (Playwright, covering: ingest URL → generate → schedule → publish)
- [ ] Security review: Vault usage audit, RLS policy review, service-role import audit
- [ ] Performance test: 50 concurrent ingestion jobs; 100 posts due in same cron cycle
- [ ] LinkedIn Developer App production review submission

---

## 14. Open Questions & Risks

### Open Questions

| # | Question | Owner | Resolution Needed By | Notes |
|---|---|---|---|---|
| OQ-1 | Vercel Cron vs QStash for the publisher? | Engineering | Phase 2 start | Vercel Cron (every 5 min) is simpler for V1; QStash adds per-job scheduling and DLQ for V2 |
| OQ-2 | LinkedIn Company Page posting in V1? | Product | Phase 1 start | Requires LinkedIn Partner Program approval (2–6 week process); recommend deferring to V2 |
| OQ-3 | **Pricing model — must be resolved in Phase 0** | Business | Phase 0 | X/Twitter API COGS is variable per user (see OQ-4). Pricing must cover per-user API spend. |
| OQ-4 | X/Twitter API cost model | Engineering | Phase 0 | Pay-per-use at ~$1/1000 writes. At 10 posts/day/user = 300/month = ~$0.30/user/month COGS from X alone. Model for 100, 500, 1000 users before setting price. |
| OQ-5 | ~~Custom AES-256 vs Supabase Vault?~~ | ~~Engineering~~ | ~~Phase 0~~ | **Resolved: use Supabase Vault.** Do not roll custom encryption. |
| OQ-6 | LinkedIn Developer App production access | Engineering | Phase 0 | LinkedIn's developer app review for posting takes 1–4 weeks. Submit immediately. |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **LinkedIn bans developer app for ToS violation** | Medium (if scraping) | **Existential** | **Mitigation: do not scrape LinkedIn. Policy enforced in §11.2. This risk is fully avoided.** |
| X/Twitter API pricing increases further | Medium | High | Adapter abstraction enables pivot to aggregator (Ayrshare) quickly; budget hard cap per workspace |
| LinkedIn token silent refresh fails for large user cohort | Medium | High | Daily cron + in-app notification + email; 365-day refresh tokens make this rare |
| Playwright scraper breaks on target site DOM update | High | Low–Medium | Multiple fallback selectors; monitor ingestion success rate; site-specific breakage doesn't affect all users |
| LLM provider rate limits at scale | Medium | Medium | Groq → Gemini fallback already designed; add response caching keyed on URL hash |
| Cron double-publish on network blip | Low | High | `FOR UPDATE SKIP LOCKED` + idempotency key + `publish_attempts` guard eliminates this |
| Supabase Realtime concurrency limit hit | Medium | Low | Polling fallback when tab hidden (§9.4); upgrade Supabase plan before limit |
| Python worker memory leak from Playwright | Medium | Medium | Per-request browser launch (not persistent); Render auto-restart on OOM; RSS monitoring |
| X/Twitter does not support idempotency keys | High (known) | Medium | Best-effort deduplication via recent post query (§7.7.3); `publish_attempts` audit trail for manual reconciliation |

---

## Appendix A — Environment Variables Reference

*(See §11.5)*

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| Content Item | The logical "piece of content" — one URL or text source, regardless of how many platform variants are generated from it |
| Post Variant | One platform-specific version of a content item (e.g., the LinkedIn version vs the X version) |
| Ingestion Job | A unit of work tracking the pipeline stages for extracting content from a source |
| Platform Adapter | The code module responsible for communicating with one social media platform's API |
| Draft | A generated post variant not yet scheduled or published |
| Smart Schedule | Automatic slot selection from the user's posting schedule config |
| Brand Config | Workspace-level settings: brand name, tone, forbidden phrases, active prompt version |
| Prompt Version | A numbered, immutable snapshot of the system prompt. Active version governs all new generation. |
| Prompt Template | A named, reusable prompt extension for specific content categories (e.g., "Product Launch") |
| Connection | An authenticated link between a workspace and a social media account |
| Cron Publisher | The background job that polls for due post variants and publishes them |
| Slot | A specific date + time within the posting schedule config available for scheduling |
| Claim | An atomic `FOR UPDATE SKIP LOCKED` operation that transitions a variant from SCHEDULED to PUBLISHING |
| Visibility Timeout | The 10-minute window after claiming; if the worker doesn't complete within it, the row is released back to SCHEDULED |
| Idempotency Key | `post_variant_id` sent to platform APIs and stored in `publish_attempts` to prevent double-publish |
| MCP Connector | An authenticated integration with an external document source (Google Drive, Notion) via Model Context Protocol |

---

*Document owned by the SocialOS Product Team. Version 1.1 — reviewed and revised April 2026. Review cycle: weekly during active development.*
