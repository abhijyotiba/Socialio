# Design: "Obsidian Engine" — In-App Frontend Redesign

**Date:** 2026-05-31
**Scope:** Visual + UX redesign of the entire authenticated SocialOS web app. Frontend only — no backend, API, DB, or data-flow changes. No new marketing/landing page.

---

## 1. Goal

The current in-app UI is the generic "light + indigo/violet gradient" SaaS look: white cards, soft shadows, gradient stat tiles, a dark gradient sidebar. It is competent but unremarkable, and the user reports it feels slow to navigate and load.

Redesign the whole product surface into **one** distinctive, premium, high-performance visual language — a hybrid synthesized from two references (NUCLEUS: light, brutalist, monochrome, oversized black type; VORTEX.IO: dark, sleek, mono-font data accents, single electric accent). The result is a single dark theme called **"Obsidian Engine."** No light/dark toggle — one theme, executed to a top-tier standard.

Success criteria:
- Every authenticated surface (sidebar, dashboard, chat, campaigns, campaign detail, queue, settings, profile, onboarding) plus auth pages (login/signup) adopt the new system coherently.
- Navigation feels instant (prefetch + matched skeletons, no blank flashes or layout shift).
- Interactions feel snappy (tuned motion, optimistic where cheap).
- `pnpm typecheck` clean, `pnpm test` green, app builds.

---

## 2. Visual language

### 2.1 Identity in one sentence
A dark, high-contrast operator's console: near-black layered surfaces, oversized tight display headlines, monospace data accents, and a single electric accent used surgically.

### 2.2 Color system (replaces the `:root` tokens in `globals.css`)

Defined in OKLCH to match the existing token format. The app currently never adds `.dark` to `<html>`, so we redefine `:root` to BE the dark theme (simplest, no class wiring needed).

| Token | Role | Approx value |
|---|---|---|
| `--background` | App canvas | near-black `#0A0A0B` |
| `--surface` / `--card` | Lifted panels | `#121214` |
| `--surface-2` | Higher panels (modals, popovers) | `#17171A` |
| `--foreground` | Primary text | `#F4F4F5` (near-white) |
| `--muted-foreground` | Secondary text | `#8A8A93` |
| `--faint-foreground` | Tertiary / labels | `#5C5C66` |
| `--border` | Hairline borders | white @ 8% |
| `--border-strong` | Emphasized borders | white @ 14% |
| `--accent` | THE accent | electric red-orange `oklch(0.66 0.21 32)` ≈ `#FF4D2E` |
| `--accent-foreground` | Text on accent | near-black |
| Greyscale ramp | `--grey-1..5` | NUCLEUS-style swatch ramp for charts/bars |
| `--success` / `--warning` / `--danger` | Status | restrained green / amber / red |

The accent is used ONLY for: primary action buttons, active nav indicator, key live metric, focus rings, links. Never as a background wash. Discipline is the point.

### 2.3 Typography

- **Display** (page titles, big numbers): keep Outfit (`--font-display`) but push to `font-black`, very tight tracking (`-0.04em`), large sizes. NUCLEUS energy — titles are architectural. Add a utility `.display-xl` etc.
- **Body / UI**: Inter (`--font-inter`) — unchanged choice, refined sizing scale.
- **Mono** (data accents): the existing `--app-font-mono` (Cascadia/Consolas) for ALL numerics, metrics, timestamps, IDs, hashes, counts, latencies. This is the signature. Helper class `.mono-num` (mono + tabular-nums + tracking).
- **Micro-labels**: uppercase, letter-spaced (`tracking-[0.2em]`), `--faint-foreground`, mono or Inter. (e.g. `ACTIVE INSTANCES`, `BY PLATFORM`.)

### 2.4 Surfaces, borders, radius

- Move from heavy rounded cards + drop shadows to **hairline-bordered flat panels** on lifted surfaces. Shadows become subtle and dark (glow only on accent/active).
- Radius: tighten. `--radius` from `0.625rem` → `0.5rem`; large panels use `0.75rem`. Hard-edged confidence, not pill-soft.
- A subtle 1px grid/noise texture on the canvas background (very low opacity), echoing both references.

### 2.5 Motion

- Reuse/extend the keyframes already in `globals.css` (`fadeUp`, `fadeIn`, `messageIn`, stagger). Retune durations to feel crisp (180–260ms, `cubic-bezier(0.22, 1, 0.36, 1)`).
- Page enter: fade-up. Stat/cards: staggered fade-up.
- Hover: border brightening + faint accent glow instead of lift+shadow (cheaper, sharper).
- Respect `prefers-reduced-motion` (wrap animations).

---

## 3. Performance / UX (the "feels slow" complaint)

These are real changes, not just paint:

1. **Prefetch nav** — `<Link prefetch>` on sidebar items (Next prefetches by default in viewport; ensure not disabled). Active-route detection already exists.
2. **Matched skeletons** — restyle existing `loading.tsx` skeletons (`SkeletonDashboard`, queue/profile loading) to the new dark system so the loading state looks like the loaded state (no jarring swap, no layout shift). Add `loading.tsx` for chat/campaigns/settings if missing and cheap.
3. **No content-pop** — content enters with the tuned fade-up; skeletons share exact dimensions with real content to kill layout shift.
4. **Optimistic micro-interactions** — keep existing client islands; ensure button/tab/drawer transitions are instant (CSS, not round-trips). Filter tabs already use URL params + `scroll={false}` — preserve.

No router/data refactor. We are not changing how pages fetch; we are making the perceived load tier-1.

---

## 4. Architecture & approach

### 4.1 Token-first, then roll out
1. Rewrite the design tokens + base layer + animation utilities in `web/app/globals.css`. This is the single source of truth; most pages already consume tokens (`bg-card`, `text-foreground`, etc.) OR hardcode slate/indigo classes.
2. The catch: **many pages hardcode `slate-*` / `indigo-*` / `white` Tailwind classes** rather than tokens. Token changes alone won't flip them. So each page needs a styling pass to replace hardcoded light classes with the new dark token-based classes.
3. Restyle the shared shell first (Sidebar, app layout, auth layout, UI primitives: button/card/input/textarea/label), then each page.

### 4.2 New shared primitives (small, focused, reused)
To avoid repeating Tailwind soup and to keep edits reliable, introduce a few presentational helpers in `web/components/ui/` and CSS utilities:
- `Panel` — the standard hairline-bordered surface (replaces ad-hoc `rounded-2xl border bg-white shadow-sm`).
- `Stat` — label + mono big number + optional sparkline slot (dashboard/queue stat tiles).
- `MicroLabel` — uppercase tracked caps.
- CSS utilities in `globals.css`: `.mono-num`, `.display-xl/lg`, `.panel`, `.hairline`, `.accent-glow`, `.grid-bg`.

These are presentational only — no logic, no data. Each is independently understandable: what it renders, what props it takes, no hidden deps.

### 4.3 What stays the same
- All page data fetching, server components, client island boundaries, routes, props.
- All `lib/db`, worker calls, auth.
- Component file structure (we restyle in place; only add small UI primitives).

### 4.4 Surfaces to redesign (inventory)
- **Shell:** `app/(app)/layout.tsx`, `components/app/Sidebar.tsx`, `app/(auth)/layout.tsx`
- **UI primitives:** `components/ui/{button,card,input,textarea,label}.tsx`
- **Pages:** dashboard (+ `loading`, `SkeletonDashboard`, charts), chat (+ its `_components/*`), campaigns list, campaign detail (+ `_components/*`), queue (+ `QueueList`, modals/drawers), settings/* (brand, connections, personas, schedule, autopilot), profile, onboarding, login, signup, `error.tsx`/`global-error.tsx`.
- **Shared app components:** `LowFuelBanner`, any badges/banners.

---

## 5. Component-level direction (highlights)

- **Sidebar:** stays dark (already is) but re-tuned to the new palette — remove violet gradient, use near-black + hairline + accent active indicator (sharp left bar in accent, mono section label). Logo mark becomes monochrome with accent dot.
- **Dashboard:** the gradient hero stat tile → a flat panel with an oversized mono number (VORTEX `99.99%` energy) + micro-label + greyscale node-distribution bar. Charts recolor to accent line on dark. "Overview" title becomes large display-black.
- **Chat (the wedge):** dark canvas, message bubbles as hairline panels, AI vs user distinguished by alignment + accent edge. Empty-state hero uses big display type + mono suggestion chips. Tuned `messageIn`.
- **Campaigns / Queue:** list rows become hairline panels with mono timestamps/counts; status pills recolored to restrained tones on dark; platform breakdown bars use greyscale ramp + accent.
- **Auth:** dark split layout already; align to new palette, replace indigo radial with accent-tinted grid/noise, oversized display headline.

---

## 6. Risks & mitigations

- **Large surface area / breakage risk:** Mitigate by (a) doing tokens + shell + primitives first and verifying build, (b) restyling page-by-page with typecheck between batches, (c) committing per working increment.
- **Hardcoded color classes everywhere:** This is the bulk of the work. Mitigate with the new primitives + utilities so future pages don't re-hardcode, and a grep sweep for residual `slate-`/`indigo-`/`bg-white` on dark surfaces.
- **Contrast/accessibility:** Verify text/background contrast on the dark theme (≥ 4.5:1 for body). Accent is for emphasis, not body text.
- **No new dependencies.** Fonts (Inter/Outfit) and mono already configured. No npm installs.

---

## 7. Out of scope

- Marketing/landing page (user confirmed: in-app only).
- Backend, worker, DB, API contracts.
- New features or behavior changes — purely visual/UX.
- Light theme / theme toggle.

---

## 8. Execution order (for the implementation plan)

1. Tokens + base layer + utilities in `globals.css`; layout metadata.
2. Shared UI primitives (button/card/input/textarea/label) + new `Panel`/`Stat`/`MicroLabel`.
3. Shell: app layout, Sidebar, auth layout.
4. Skeletons + `loading.tsx` (perf), matched to new system.
5. Dashboard (+ charts).
6. Chat + chat `_components`.
7. Campaigns list + campaign detail `_components`.
8. Queue + list/modals.
9. Settings/* + profile + onboarding.
10. Auth pages, error pages.
11. Sweep for residual hardcoded light classes; final typecheck + test + build.
