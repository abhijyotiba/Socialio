# SocialOS

A multi-tenant social media content automation platform. Users connect LinkedIn and X, paste a URL or idea, and get a brand-aligned, scheduled post at the other end.

> **Status:** pre-code. Phase 0 (foundation) scaffolding in progress.

## What's in this repo

- `CLAUDE.md` — project operating manual, read first
- `docs/PRD.md` — product requirements
- `docs/ARCHITECTURE.md` — system shape, folders, patterns
- `docs/DATA_MODEL.md` — database schema (single source of truth)
- `docs/API_CONTRACTS.md` — every custom endpoint
- `docs/DECISIONS.md` — architectural decision log (append-only)
- `docs/SESSION_NOTES.md` — session-to-session handoff notes
- `docs/BACKLOG.md` — stuff noticed during a phase that belongs elsewhere
- `docs/phases/` — one brief per phase; the scope contract for that phase
- `web/` — Next.js 15 app (created in Phase 0)
- `worker/` — Python FastAPI service (created in Phase 2)
- `supabase/migrations/` — numbered SQL migrations

## Getting started (developers)

1. Clone the repo
2. Copy `.env.example` to `.env.local`, fill in values
3. `pnpm install --dir web`
4. `supabase link --project-ref <your-project>`
5. `supabase db push` to apply migrations
6. `pnpm --dir web dev`

## Getting started (Claude Code)

See `CLAUDE.md` for the operating manual. At session start, read:

1. `CLAUDE.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DATA_MODEL.md`
4. The current phase doc (see `CLAUDE.md` §2)
5. Top entry of `docs/SESSION_NOTES.md`

## Tech stack

Next.js 15, Supabase, Cloudinary, Groq + Gemini, FastAPI + Playwright, TypeScript, Tailwind, shadcn/ui. Hosted on Vercel + Fly.io.