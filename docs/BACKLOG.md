# Backlog

Items noticed during a phase that belong in a different phase or are out-of-scope for now. Add an entry when you notice something — do not fix it in the current phase.

---

## Auth

- **Google OAuth login** — Add "Continue with Google" button to `/login` and `/signup` via Supabase Auth. Skipped in Phase 1 per user instruction. Supabase Auth Google provider needs to be enabled in the dashboard before implementing.

---

## Voice & generation quality (Phase 7 — see `docs/phases/PHASE_7_VOICE.md`)

- **Voice profile from pasted samples** — Onboarding flow where users paste 3–15 of their own posts; worker analyzes them into a structured `voice_profile` JSON; we render a personalised system prompt from it and store both alongside the existing `prompt_versions` history. **In Phase 7.**
- **Inline regeneration with instruction** — Quick-action chips ("Shorter", "More personal", "Change hook") plus a free-text instruction box on each variant card. New `post_variant_revisions` table preserves prior bodies for revert. **In Phase 7.**
- **Edit-diff feedback loop** — Store the diff between AI draft and final published body; fold patterns ("user always deletes the last paragraph") back into the voice profile. **Deferred — gated on Phase 7 shipping and signal that voice profiles meaningfully change perceived quality.**
- **Performance-based learning** — Use `post_metrics` to bias generation toward styles the user's audience engaged with. **Deferred to Phase 8+.**
- **Voice signal from user's own website / blog** — Legally fine (it's their site) and could enrich the profile. **Deferred — paste flow must work first.**
- **Batch generation from a topic** — "Generate 5 posts about AI in healthcare." Pushes positioning back toward "set it and forget it" automation, which the V1 product critique flagged as the riskier framing. **Deferred to V2.**
- **Thread generation for X, long-form LinkedIn articles** — Higher ceiling but materially more complex than single-post generation. **Deferred to V2.**
