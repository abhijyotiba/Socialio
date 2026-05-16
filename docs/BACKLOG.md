# Backlog

Items noticed during a phase that belong in a different phase or are out-of-scope for now. Add an entry when you notice something — do not fix it in the current phase.

---

## Observability

- **Swap lightweight error logger for Sentry** — Migration 0018 introduces an `error_events` table and `lib/observability/log-error.ts` is the only writer. Adding `@sentry/nextjs` would give us source-map decoding, breadcrumbs, alerting, and release tracking out of the box. Requires explicit approval to add the runtime dependency (per CLAUDE.md §4 and §10) and DSN env-var wiring. Once added, `logError()` becomes a thin wrapper around `Sentry.captureException()` and the `error_events` table can be kept as a redundant local audit or dropped. Discovered: Phase V2.2 hardening pass.
- **Surface `error_events` to operators** — Right now the table has no read surface (RLS allows no policies; only `service_role` can query). Build a tiny `/admin/errors` page gated by a hard-coded allowlist, or wire up Supabase Studio for ops use. Discovered: Phase V2.2 hardening pass.

---

## Persona deletion safety

- **Block persona deletion when published variants exist** — `personas.id` is referenced by `post_variants.persona_id` with `ON DELETE SET NULL` (migration 0014), so deleting a persona orphans its published variants and forces the publish/regenerate routes to keep a `_legacy/` fallback. Either (a) prevent deletion while published variants exist (mirror the active-campaign guard already in `deletePersona`), or (b) change the FK to `ON DELETE CASCADE`. Once either lands, the `_legacy/{brand-configs,social-connections}.ts` fallback files and their per-line `eslint-disable` annotations can be deleted entirely. Discovered: Phase V2.2 hardening pass.

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
