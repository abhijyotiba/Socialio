# Backlog

Items noticed during a phase that belong in a different phase or are out-of-scope for now. Add an entry when you notice something — do not fix it in the current phase.

---

## Auth

- **Google OAuth login** — Add "Continue with Google" button to `/login` and `/signup` via Supabase Auth. Skipped in Phase 1 per user instruction. Supabase Auth Google provider needs to be enabled in the dashboard before implementing.

---

### Replace google-generativeai with google-genai SDK

**File:** `worker/adapters/gemini.py`, `worker/pyproject.toml`

The `google-generativeai>=0.8` package is deprecated and EOL. Google has ended all support and bug fixes. The replacement is `google-genai` (the new unified Google Gen AI Python SDK). Migration requires:
- Replace `google-generativeai` with `google-genai` in `pyproject.toml` (requires user approval per CLAUDE.md §3)
- Update `worker/adapters/gemini.py` to use `from google import genai; client = genai.Client(api_key=...)`
- Note in `docs/DECISIONS.md`

Priority: before production launch.
