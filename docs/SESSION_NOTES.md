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