# Obsidian Engine Frontend Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire authenticated SocialOS web app into one premium dark "Obsidian Engine" theme — near-black layered surfaces, oversized display headlines, monospace data accents, one electric accent — with snappy navigation and matched loading states. Frontend only; no backend/data/route changes.

**Architecture:** Token-first. Rewrite design tokens + base layer + utility classes in `web/app/globals.css` (the single source of truth), then restyle the shared shell (layouts, Sidebar, UI primitives), then each page. Many pages hardcode `slate-*`/`indigo-*`/`white` classes, so each gets a styling pass that swaps those for new token-based dark classes. Small presentational primitives (`Panel`, `Stat`, `MicroLabel`) + CSS utilities (`.mono-num`, `.display-xl`, `.panel`, `.grid-bg`, `.accent-glow`) prevent Tailwind-soup duplication.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS v4 (CSS-first `@theme`), `@base-ui/react`, `class-variance-authority`, `lucide-react`, fonts Inter + Outfit + mono (already configured).

**Verification gate (every task):** This is a visual restyle with no new logic. The verification loop is `pnpm typecheck` clean + `pnpm test` green (existing logic tests must keep passing — they guard against broken imports/logic) + the app builds. We do NOT write brittle "assert div has class X" render tests — that violates the project's simplicity-first rule and the existing test suite is logic/db only. Visual correctness is confirmed by running the dev server and inspecting.

**Commands (run from `web/`):**
- Typecheck: `pnpm typecheck`
- Test: `pnpm test`
- Build (final gate only, slow): `pnpm build`
- Dev server for visual check: `pnpm dev` → http://localhost:3000

---

## File Structure

**Tokens & globals (source of truth):**
- Modify: `web/app/globals.css` — new dark tokens, base layer, utilities, keyframes
- Modify: `web/app/layout.tsx` — body classes, grid-bg, metadata

**New presentational primitives:**
- Create: `web/components/ui/panel.tsx` — hairline-bordered surface
- Create: `web/components/ui/stat.tsx` — label + mono big number + sparkline slot
- Create: `web/components/ui/micro-label.tsx` — uppercase tracked caps

**Existing UI primitives (restyle):**
- Modify: `web/components/ui/{button,card,input,textarea,label}.tsx`

**Shell:**
- Modify: `web/app/(app)/layout.tsx`, `web/components/app/Sidebar.tsx`, `web/app/(auth)/layout.tsx`

**Loading/skeletons:**
- Modify: `web/components/app/SkeletonDashboard.tsx`, `web/app/(app)/dashboard/loading.tsx`, `web/app/(app)/queue/loading.tsx`, `web/app/(app)/profile/loading.tsx`

**Pages & their components:**
- Dashboard: `web/app/(app)/dashboard/page.tsx`
- Chat: `web/app/(app)/chat/page.tsx` + `_components/{AiMessage,ChatInput,ExtractionCard,MediaPicker,PersonaSelector,TypingIndicator,UserBubble}.tsx`
- Campaigns: `web/app/(app)/campaigns/page.tsx`, `_components/ClientRelativeTime.tsx`, `web/app/(app)/campaigns/[id]/page.tsx` + `_components/{AutopilotVariantList,CampaignReview,MediaPicker,PersonaGroup,RefinePanel,RevisionHistory,VariantBody,VariantCard}.tsx`
- Queue: `web/app/(app)/queue/page.tsx` + `_components/{PostDetailDrawer,PostPreviewModal,QueueList}.tsx`
- Settings: `web/app/(app)/settings/layout.tsx` + `{autopilot,brand,connections,personas,schedule}/**`
- Profile: `web/app/(app)/profile/page.tsx` + `_components/*`
- Onboarding: `web/app/(app)/onboarding/page.tsx` + `_components/*`
- Auth: `web/app/(auth)/login/page.tsx`, `web/app/(auth)/signup/page.tsx`
- Shared: `web/components/app/LowFuelBanner.tsx`
- Errors: `web/app/error.tsx`, `web/app/global-error.tsx`

**Color decisions (locked):** accent = electric red-orange `oklch(0.66 0.21 32)` (`#FF4D2E`); theme = dark only (no `.dark` class — `:root` IS dark).

---

## Task 1: Design tokens, base layer, and utility classes in globals.css

**Files:**
- Modify: `web/app/globals.css`

- [ ] **Step 1: Rewrite `:root` tokens to the dark Obsidian palette**

Replace the entire `:root { ... }` block (lines ~50-84) AND the `.dark { ... }` block (lines ~86-118) with a single `:root` block below. We delete `.dark` entirely — the app never adds the `dark` class, and one theme is the spec. Keep the `@theme inline` block (lines 5-48) as-is EXCEPT add the new mappings shown in Step 2.

Replace from `:root {` through the end of the `.dark { ... }` block with:

```css
:root {
  --app-font-mono: "Cascadia Code", "Consolas", "Courier New", monospace;

  /* Canvas + surfaces */
  --background: oklch(0.16 0.004 270);      /* #0A0A0B-ish near black */
  --foreground: oklch(0.96 0.003 270);      /* near white */
  --surface: oklch(0.20 0.004 270);         /* #121214 lifted panel */
  --surface-2: oklch(0.235 0.004 270);      /* #17171A higher panel */
  --card: oklch(0.20 0.004 270);
  --card-foreground: oklch(0.96 0.003 270);
  --popover: oklch(0.235 0.004 270);
  --popover-foreground: oklch(0.96 0.003 270);

  /* Text ramp */
  --muted: oklch(0.235 0.004 270);
  --muted-foreground: oklch(0.62 0.006 270); /* secondary */
  --faint-foreground: oklch(0.45 0.006 270); /* tertiary / labels */

  /* THE accent — electric red-orange, used surgically */
  --accent: oklch(0.66 0.21 32);
  --accent-foreground: oklch(0.16 0.004 270);
  --primary: oklch(0.66 0.21 32);
  --primary-foreground: oklch(0.16 0.004 270);

  /* Secondary surfaces (neutral chips/buttons) */
  --secondary: oklch(0.255 0.004 270);
  --secondary-foreground: oklch(0.92 0.003 270);

  /* Borders */
  --border: oklch(1 0 0 / 8%);
  --border-strong: oklch(1 0 0 / 14%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.66 0.21 32 / 60%);

  /* Status (restrained on dark) */
  --destructive: oklch(0.62 0.20 25);
  --success: oklch(0.70 0.16 155);
  --warning: oklch(0.78 0.15 80);

  /* Greyscale ramp (NUCLEUS node-distribution bars / charts) */
  --grey-1: oklch(0.92 0.003 270);
  --grey-2: oklch(0.70 0.004 270);
  --grey-3: oklch(0.52 0.004 270);
  --grey-4: oklch(0.38 0.004 270);
  --grey-5: oklch(0.28 0.004 270);
  --chart-1: var(--grey-1);
  --chart-2: var(--grey-2);
  --chart-3: var(--grey-3);
  --chart-4: var(--grey-4);
  --chart-5: var(--grey-5);

  --radius: 0.5rem;

  /* Sidebar = same near-black family */
  --sidebar: oklch(0.18 0.004 270);
  --sidebar-foreground: oklch(0.94 0.003 270);
  --sidebar-primary: oklch(0.66 0.21 32);
  --sidebar-primary-foreground: oklch(0.16 0.004 270);
  --sidebar-accent: oklch(0.25 0.004 270);
  --sidebar-accent-foreground: oklch(0.96 0.003 270);
  --sidebar-border: oklch(1 0 0 / 8%);
  --sidebar-ring: oklch(0.66 0.21 32 / 60%);
}
```

- [ ] **Step 2: Add new token mappings to `@theme inline`**

Inside the existing `@theme inline { ... }` block (after the `--color-card: var(--card);` line), add:

```css
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-faint-foreground: var(--faint-foreground);
  --color-border-strong: var(--border-strong);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-grey-1: var(--grey-1);
  --color-grey-2: var(--grey-2);
  --color-grey-3: var(--grey-3);
  --color-grey-4: var(--grey-4);
  --color-grey-5: var(--grey-5);
```

- [ ] **Step 3: Rewrite the base layer for the dark canvas**

Replace the `@layer base { ... }` block (lines ~120-136) with:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    background-image:
      radial-gradient(900px 600px at 85% -10%, oklch(0.66 0.21 32 / 0.07), transparent 60%),
      radial-gradient(700px 500px at 0% 110%, oklch(0.66 0.21 32 / 0.04), transparent 55%);
    background-attachment: fixed;
  }
  html {
    @apply font-sans;
    color-scheme: dark;
  }
  ::selection {
    background: oklch(0.66 0.21 32 / 0.30);
    color: oklch(0.98 0 0);
  }
  /* Dark scrollbars */
  * {
    scrollbar-color: oklch(0.40 0.004 270) transparent;
  }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-thumb {
    background: oklch(0.34 0.004 270);
    border-radius: 8px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  *::-webkit-scrollbar-thumb:hover { background: oklch(0.44 0.004 270); }
}
```

- [ ] **Step 4: Add the new utility classes**

Append to the END of `globals.css` (after the existing `.typing-dot` rule):

```css
/* ── Obsidian utilities ─────────────────────────────────── */

/* Monospace data accents — numbers, metrics, IDs, timestamps */
.mono-num {
  font-family: var(--app-font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* Oversized display headlines (NUCLEUS energy) */
.display-xl {
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 0.95;
}
.display-lg {
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: -0.035em;
  line-height: 1;
}

/* Uppercase tracked micro-label */
.micro-label {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--faint-foreground);
}

/* Standard hairline panel */
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}
.panel-2 {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

/* Hover: brighten border + faint accent glow (replaces lift+shadow) */
.panel-hover {
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}
.panel-hover:hover {
  border-color: var(--border-strong);
  box-shadow: 0 0 0 1px oklch(0.66 0.21 32 / 0.10), 0 12px 40px -16px oklch(0 0 0 / 0.6);
}

.accent-glow {
  box-shadow: 0 0 0 1px oklch(0.66 0.21 32 / 0.30), 0 8px 30px -10px oklch(0.66 0.21 32 / 0.45);
}

/* Subtle grid texture for the canvas / hero areas */
.grid-bg {
  background-image:
    linear-gradient(oklch(1 0 0 / 0.025) 1px, transparent 1px),
    linear-gradient(90deg, oklch(1 0 0 / 0.025) 1px, transparent 1px);
  background-size: 44px 44px;
}

/* Reduced-motion guard for all custom animations */
@media (prefers-reduced-motion: reduce) {
  .animate-message-in,
  .animate-fade-up,
  .animate-fade-in,
  .page-enter,
  .skeleton,
  .typing-dot { animation: none !important; }
  .panel-hover { transition: none; }
}
```

- [ ] **Step 5: Retune the skeleton loader to dark**

Replace the existing `.skeleton { ... }` rule (lines ~188-198) with:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    oklch(0.22 0.004 270) 0px,
    oklch(0.27 0.004 270) 300px,
    oklch(0.22 0.004 270) 600px
  );
  background-size: 600px 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: 8px;
}
```

- [ ] **Step 6: Retune the card-lift to dark glow**

Replace the existing `.card-lift:hover { ... }` rule (lines ~205-208) with:

```css
.card-lift:hover {
  box-shadow: 0 0 0 1px oklch(0.66 0.21 32 / 0.12), 0 16px 50px -18px oklch(0 0 0 / 0.7);
  transform: translateY(-2px);
}
```

- [ ] **Step 7: Verify typecheck + tests still pass (CSS-only, must be green)**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, all existing tests pass (CSS changes don't affect them).

- [ ] **Step 8: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(web): dark Obsidian Engine design tokens + utilities"
```

---

## Task 2: Root layout — body classes + metadata

**Files:**
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Add grid texture + dark body**

In `web/app/layout.tsx`, change the `<body>` line:

```tsx
      <body className="min-h-full font-sans antialiased grid-bg" suppressHydrationWarning>
```

And keep the `<html>` as-is (already `h-full antialiased`). Metadata title/description stay the same.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add web/app/layout.tsx
git commit -m "feat(web): apply grid texture to app body"
```

---

## Task 3: New presentational primitives — Panel, Stat, MicroLabel

**Files:**
- Create: `web/components/ui/panel.tsx`
- Create: `web/components/ui/micro-label.tsx`
- Create: `web/components/ui/stat.tsx`

- [ ] **Step 1: Create `panel.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standard hairline-bordered surface for the dark theme.
 * `hover` adds the border-brighten + faint accent glow on hover.
 * `tone="2"` uses the higher surface (modals/popovers).
 */
function Panel({
  className,
  hover = false,
  tone = "1",
  ...props
}: React.ComponentProps<"div"> & { hover?: boolean; tone?: "1" | "2" }) {
  return (
    <div
      data-slot="panel"
      className={cn(
        tone === "2" ? "panel-2" : "panel",
        hover && "panel-hover",
        className
      )}
      {...props}
    />
  );
}

export { Panel };
```

- [ ] **Step 2: Create `micro-label.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

/** Uppercase, letter-spaced tertiary label (e.g. "ACTIVE INSTANCES"). */
function MicroLabel({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("micro-label", className)} {...props} />;
}

export { MicroLabel };
```

- [ ] **Step 3: Create `stat.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { MicroLabel } from "@/components/ui/micro-label";

/**
 * Metric tile: micro-label + oversized mono number + optional accessory
 * (icon, sparkline). Presentational only.
 */
function Stat({
  label,
  value,
  sub,
  accessory,
  accent = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accessory?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Panel hover className={cn("relative overflow-hidden p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {accessory}
      </div>
      <p
        className={cn(
          "mono-num mt-3 text-4xl font-bold leading-none",
          accent ? "text-accent" : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-3 text-[11px] text-muted-foreground">{sub}</div>}
    </Panel>
  );
}

export { Stat };
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck`
Expected: clean (these are typed presentational components; `text-accent`/`text-muted-foreground` map to tokens via `@theme`).

```bash
git add web/components/ui/panel.tsx web/components/ui/micro-label.tsx web/components/ui/stat.tsx
git commit -m "feat(web): add Panel, Stat, MicroLabel primitives"
```

---

## Task 4: Restyle UI primitives (button, card, input, textarea, label)

**Files:**
- Modify: `web/components/ui/button.tsx`
- Modify: `web/components/ui/card.tsx`
- Modify: `web/components/ui/input.tsx`
- Modify: `web/components/ui/textarea.tsx`
- Modify: `web/components/ui/label.tsx`

These already consume tokens, so most flip automatically. Targeted tweaks:

- [ ] **Step 1: Card — surface + hairline (no change to logic)**

In `web/components/ui/card.tsx`, change the `Card` base classes string. Replace `bg-card` with `bg-card` (already token) but swap the ring + shadow: change `ring-1 ring-foreground/10` to `ring-1 ring-border` so it reads as a hairline on dark. The exact string in `Card`:

Replace:
```
"group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 ...
```
with the same string but `ring-1 ring-border` instead of `ring-1 ring-foreground/10`. Also in `CardFooter`, `bg-muted/50` already maps to a dark muted — leave it.

- [ ] **Step 2: Input — dark field**

Read `web/components/ui/input.tsx`. Ensure its classes use `bg-transparent`/`border-input`/`text-foreground` tokens. If it hardcodes `bg-white` or `text-slate-*`, replace with `bg-surface text-foreground placeholder:text-faint-foreground border-input`. Keep focus ring as `focus-visible:ring-ring`.

- [ ] **Step 3: Textarea — same treatment as input**

Read `web/components/ui/textarea.tsx`; apply the same token-based dark field classes as Step 2.

- [ ] **Step 4: Label — token color**

Read `web/components/ui/label.tsx`; ensure text uses `text-foreground` or `text-muted-foreground`, not a hardcoded slate.

- [ ] **Step 5: Button — accent primary already maps**

`button.tsx` `default` variant is `bg-primary text-primary-foreground` which now resolves to accent. No change needed unless an `[a]:hover:bg-primary/80` looks off — leave as-is.

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green.

```bash
git add web/components/ui/
git commit -m "feat(web): restyle UI primitives for dark theme"
```

---

## Task 5: Shell — app layout

**Files:**
- Modify: `web/app/(app)/layout.tsx`

- [ ] **Step 1: Swap the light radial backdrop for a dark accent-tinted one**

In `web/app/(app)/layout.tsx`, the `<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(...)]" />` uses indigo/blue light radials. Replace that element's className with:

```tsx
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_700px_at_20%_-10%,oklch(0.66_0.21_32/0.06),transparent),radial-gradient(900px_600px_at_100%_110%,oklch(0.66_0.21_32/0.04),transparent)]" />
```

Outer wrapper `bg-transparent` is fine (body is dark). Leave the rest (`<Sidebar />`, `<main>`) structurally unchanged.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck`

```bash
git add "web/app/(app)/layout.tsx"
git commit -m "feat(web): dark accent backdrop in app shell"
```

---

## Task 6: Shell — Sidebar

**Files:**
- Modify: `web/components/app/Sidebar.tsx`

- [ ] **Step 1: Re-tune the sidebar container**

In `Sidebar.tsx`, replace the violet-gradient container background. Change the `<div className="relative m-3 mr-0 flex h-[calc(100vh-1.5rem)] ... bg-[linear-gradient(165deg,#141727...)] ...">` background to the near-black sidebar surface + hairline:

Replace the long container className's background portion `bg-[linear-gradient(165deg,#141727_0%,#19132f_54%,#101a2b_100%)]` with `bg-sidebar` and change `border-white/10` to `border-border`. Replace the decorative blur `bg-indigo-500/20` with `bg-[oklch(0.66_0.21_32/0.14)]`.

- [ ] **Step 2: Logo mark → monochrome + accent dot**

Replace the logo icon container `bg-gradient-to-br from-indigo-500 to-violet-500 ... shadow-indigo-500/30` with `bg-surface-2 ring-1 ring-border text-accent` and keep the `Zap` icon. Change the "Content Engine" sublabel `text-indigo-300/85` to `text-accent/80` and make it use `.micro-label` styling (or `text-[9px] font-semibold uppercase tracking-[0.28em] text-accent/80`).

- [ ] **Step 3: Active nav → accent indicator**

In the nav map, change the active state. Replace active classes `bg-white/10 text-white shadow-lg shadow-black/20` with `bg-white/[0.06] text-foreground`. Replace the active left bar `bg-indigo-500` with `bg-accent`. Replace the active icon classes `text-indigo-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.7)]` with `text-accent drop-shadow-[0_0_8px_oklch(0.66_0.21_32/0.7)]`. Inactive `text-gray-400 hover:bg-white/5 hover:text-white` → `text-muted-foreground hover:bg-white/[0.04] hover:text-foreground`.

- [ ] **Step 4: Profile card + sign-out → tokens**

Profile avatar `bg-gradient-to-br from-indigo-500 to-violet-500` → `bg-surface-2 ring-1 ring-border text-accent`. Active profile border `border-indigo-500/40 bg-white/10` → `border-accent/40 bg-white/[0.06]`. Replace residual `text-gray-*`/`text-white`/`border-white/*` with `text-muted-foreground`/`text-foreground`/`border-border`. Sign-out hover red stays (`group-hover:bg-red-500/20 group-hover:text-red-400`).

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck`

```bash
git add web/components/app/Sidebar.tsx
git commit -m "feat(web): dark Obsidian sidebar with accent nav"
```

---

## Task 7: Loading skeletons matched to dark system

**Files:**
- Modify: `web/components/app/SkeletonDashboard.tsx`
- Modify: `web/app/(app)/queue/loading.tsx`
- Modify: `web/app/(app)/profile/loading.tsx`

- [ ] **Step 1: Read all three files**

Read `SkeletonDashboard.tsx`, `queue/loading.tsx`, `profile/loading.tsx` to see current structure.

- [ ] **Step 2: Swap light surfaces for dark in each**

In each file, replace `bg-white` → `bg-surface`, `border-slate-200`/`border-slate-100` → `border-border`, any `bg-slate-100`/`bg-slate-200` skeleton blocks → keep the `.skeleton` class (already dark from Task 1) or `bg-surface-2`. Goal: skeleton dimensions are unchanged (no layout shift) but colors match the dark loaded page. Do not change layout/spacing.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck`

```bash
git add web/components/app/SkeletonDashboard.tsx "web/app/(app)/queue/loading.tsx" "web/app/(app)/profile/loading.tsx"
git commit -m "feat(web): dark loading skeletons (no layout shift)"
```

---

## Task 8: Dashboard

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Header — display title + token icon tile**

Replace the header icon tile `bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100` with `bg-surface-2 text-accent ring-1 ring-border`. Change `<h1 ... text-slate-900>Overview</h1>` to use `.display-lg text-foreground text-3xl` and `text-slate-400` subtitle → `text-faint-foreground`. The date/last-7-days subtitle: wrap the date in `.mono-num`.

- [ ] **Step 2: "New Post" button → accent**

Replace the button `bg-indigo-600 ... hover:bg-indigo-700` with `bg-accent text-accent-foreground hover:brightness-110`.

- [ ] **Step 3: Persona filter pills → tokens**

Replace `bg-slate-900 text-white` active → `bg-accent text-accent-foreground`; inactive `bg-white text-slate-600 ring-slate-200 hover:bg-slate-50` → `bg-surface text-muted-foreground ring-border hover:bg-surface-2`. The `View` micro-label `text-slate-400` → `.micro-label`. Persona-colored active pills keep their `avatar_color` inline style.

- [ ] **Step 4: Stat cards → flat panels with mono numbers**

Replace the three stat cards. The gradient hero (`bg-gradient-to-br from-indigo-600 via-violet-600...`) becomes a flat `Panel hover` with an accent mono number. Convert the published-count card to:
```tsx
<Panel hover className="relative overflow-hidden p-5">
  <div className="pointer-events-none absolute right-2 top-1 text-accent/10"><Zap className="h-16 w-16" fill="currentColor" /></div>
  <MicroLabel>Posts Published</MicroLabel>
  <p className="mono-num mt-3 text-4xl font-bold leading-none text-accent">{publishedCount}</p>
  <p className="mt-3 text-[11px] text-muted-foreground">{publishedCount > 0 ? "All-time total across platforms" : "No posts yet — create your first"}</p>
</Panel>
```
For Impressions + Likes cards, replace `border-slate-200/70 bg-white shadow-sm` → use `Panel hover`; replace number text color `text-slate-900` → `text-foreground` and add `mono-num`; micro-labels via `MicroLabel`; the icon tiles `bg-indigo-50 text-indigo-500`/`bg-violet-50 text-violet-500` → `bg-surface-2 text-accent ring-1 ring-border`. Import `Panel`, `MicroLabel` at top: `import { Panel } from "@/components/ui/panel"; import { MicroLabel } from "@/components/ui/micro-label";`

- [ ] **Step 5: Recolor the charts to accent-on-dark**

In `LineChart`: gradient stops `#6366f1` → `#FF4D2E`; grid line `stroke="#f1f5f9"` → `stroke="oklch(1 0 0 / 0.06)"`; axis text `fill="#94a3b8"` → `fill="oklch(0.55 0.006 270)"`; line stroke `#6366f1` → `#FF4D2E`; point circles `fill="#fff" stroke="#6366f1"` → `fill="var(--background)" stroke="#FF4D2E"`. In `MiniSparkline` calls, pass `color="#FF4D2E"` (impressions) and a grey `color="#8a8a93"` (likes) — update the two call sites. Panels around charts: `border-slate-200/70 bg-white shadow-sm` → `Panel`, borders `border-slate-100` → `border-border`, titles `text-slate-900` → `text-foreground`, subtitles → `text-faint-foreground`.

- [ ] **Step 6: Queue preview + recent posts → tokens**

Replace all remaining `bg-white`/`border-slate-*`/`text-slate-*`/`bg-indigo-50`/`text-indigo-*` in the queue-preview and recent-posts blocks with token equivalents: `bg-white`→`bg-surface`, `border-slate-100`→`border-border`, `text-slate-900`→`text-foreground`, `text-slate-800/700/600/500`→`text-foreground`/`text-muted-foreground`, `text-slate-400`→`text-faint-foreground`, `hover:bg-slate-50/70`→`hover:bg-white/[0.03]`, count badge `bg-indigo-50 text-indigo-600`→`bg-accent/15 text-accent`, the empty-state gradient blob → `bg-accent/15` + `bg-surface-2 ring-1 ring-border text-accent`. Numbers (impressions/likes/comments) get `.mono-num`. "View full queue" link `text-indigo-600`→`text-accent`. `PlatformIcon` LinkedIn `bg-[#0077b5]` stays (brand color); X `bg-slate-900` → `bg-surface-2 ring-1 ring-border`.

- [ ] **Step 7: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green. Then visually check `pnpm dev` → /dashboard.

```bash
git add "web/app/(app)/dashboard/page.tsx"
git commit -m "feat(web): redesign dashboard for Obsidian theme"
```

---

## Task 9: Chat page + chat components

**Files:**
- Modify: `web/app/(app)/chat/page.tsx`
- Modify: `web/app/(app)/chat/_components/{AiMessage,ChatInput,ExtractionCard,MediaPicker,PersonaSelector,TypingIndicator,UserBubble}.tsx`

- [ ] **Step 1: Chat page header + empty state**

In `chat/page.tsx`: header icon tile gradient `from-violet-600 to-indigo-600 shadow-indigo-500/30` → `bg-surface-2 ring-1 ring-border text-accent`; `<h1 ... text-slate-900>Content Studio` → `.display-lg text-foreground`; subtitle `text-slate-400` → `text-faint-foreground`; header border `border-slate-100/80` → `border-border`. Empty-state hero blob gradient → `bg-accent/15` glow + `bg-surface-2 ring-1 ring-border` tile with `text-accent` icon; title `text-slate-900` → `text-foreground` (consider `.display-lg`); body `text-slate-400` → `text-muted-foreground`; suggestion chips `border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700` → `border-border bg-surface text-muted-foreground hover:border-accent/40 hover:bg-surface-2 hover:text-foreground`; the error text `text-red-600` → `text-destructive`.

- [ ] **Step 2: Read + restyle each chat component**

Read each of the 7 `_components` files. Apply the sweep: `bg-white`→`bg-surface`/`panel`; `border-slate-*`→`border-border`; `text-slate-900/800/700`→`text-foreground`; `text-slate-600/500`→`text-muted-foreground`; `text-slate-400`→`text-faint-foreground`; `bg-slate-50/100`→`bg-surface-2` or `bg-white/[0.03]`; `bg-indigo-*`/`text-indigo-*`/`from-indigo/violet`→accent tokens (`bg-accent`, `text-accent`, `bg-accent/15`); `text-red-600`→`text-destructive`. UserBubble (the user's message): use `bg-accent text-accent-foreground` or a neutral `bg-surface-2` with accent edge — choose accent-tinted bubble aligned right. TypingIndicator dots already use `.typing-dot` (keep) but recolor dot bg to `bg-muted-foreground`. Preserve all props, handlers, and structure.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green. Visually check /chat.

```bash
git add "web/app/(app)/chat/"
git commit -m "feat(web): redesign chat studio for Obsidian theme"
```

---

## Task 10: Campaigns list + ClientRelativeTime

**Files:**
- Modify: `web/app/(app)/campaigns/page.tsx`
- Modify: `web/app/(app)/campaigns/_components/ClientRelativeTime.tsx`
- Modify: `web/components/app/LowFuelBanner.tsx`

- [ ] **Step 1: Campaigns list page**

Header icon tile `bg-indigo-50 text-indigo-600 ring-indigo-100` → `bg-surface-2 text-accent ring-1 ring-border`; `<h1 ... text-slate-900>Campaigns` → `.display-lg text-foreground`; subtitle → `text-faint-foreground`. Empty state `border-dashed border-slate-200 bg-white` → `border-dashed border-border bg-surface`, text `text-slate-700`/`text-slate-400` → `text-foreground`/`text-faint-foreground`, link `text-indigo-600` → `text-accent`. List rows `border-slate-200/70 bg-white shadow-sm hover:border-indigo-200 hover:bg-indigo-50/30` → `panel panel-hover` (replace utility classes; use `className="flex items-center gap-4 p-4 panel panel-hover"`). Autopilot badge `bg-indigo-50 text-indigo-600` → `bg-accent/15 text-accent`. Title `text-slate-900`→`text-foreground`; meta `text-slate-400`→`text-faint-foreground`; chevron `text-slate-400`→`text-faint-foreground`. Update `STATUS_TONE` map values to dark: `bg-slate-100 text-slate-600`→`bg-surface-2 text-muted-foreground`, `bg-amber-50 text-amber-700`→`bg-warning/15 text-warning`, `bg-emerald-50 text-emerald-700`→`bg-success/15 text-success`, `bg-red-50 text-red-700`→`bg-destructive/15 text-destructive`.

- [ ] **Step 2: ClientRelativeTime + LowFuelBanner**

Read both. `ClientRelativeTime` is text — wrap output in `.mono-num` if it renders a timestamp/relative string and ensure any color is `text-faint-foreground`. `LowFuelBanner`: read it, swap light amber/white surfaces to `bg-warning/10 border-warning/30 text-warning` style on dark, replacing hardcoded `bg-amber-*`/`bg-white`/`text-slate-*`.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add "web/app/(app)/campaigns/page.tsx" "web/app/(app)/campaigns/_components/ClientRelativeTime.tsx" web/components/app/LowFuelBanner.tsx
git commit -m "feat(web): redesign campaigns list + low-fuel banner"
```

---

## Task 11: Campaign detail + its components

**Files:**
- Modify: `web/app/(app)/campaigns/[id]/page.tsx`
- Modify: `web/app/(app)/campaigns/[id]/_components/{AutopilotVariantList,CampaignReview,MediaPicker,PersonaGroup,RefinePanel,RevisionHistory,VariantBody,VariantCard}.tsx`

- [ ] **Step 1: Read the page + all 8 components**

Read each to catalog hardcoded classes. These are the most interactive surfaces (variant cards, refine panel, revision history, media picker).

- [ ] **Step 2: Apply the sweep per file**

For each file replace, consistently: `bg-white`→`bg-surface`/`panel`; `border-slate-*`/`border-gray-*`→`border-border`; `text-slate-900/800/700`→`text-foreground`; `text-slate-600/500`→`text-muted-foreground`; `text-slate-400/300`→`text-faint-foreground`; `bg-slate-50/100/200`→`bg-surface-2`/`bg-white/[0.03]`; all `indigo`/`violet`→accent (`bg-accent`, `text-accent`, `bg-accent/15`, `ring-accent/40`); status colors → `success`/`warning`/`destructive` tints as in Task 10 Step 1; `text-red-*`→`text-destructive`; `text-emerald-*`/`text-green-*`→`text-success`. Numbers/counts/char-limits/timestamps → add `.mono-num`. Active/selected variant cards: use `ring-1 ring-accent/40` + faint `accent-glow`. Buttons: primary actions `bg-accent text-accent-foreground hover:brightness-110`; secondary `bg-surface-2 text-foreground ring-1 ring-border hover:bg-white/[0.05]`. Preserve ALL logic, props, state, handlers — visual classes only.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green. Visually check a campaign detail page.

```bash
git add "web/app/(app)/campaigns/[id]/"
git commit -m "feat(web): redesign campaign detail + variant cards"
```

---

## Task 12: Queue + queue components

**Files:**
- Modify: `web/app/(app)/queue/page.tsx`
- Modify: `web/app/(app)/queue/_components/{PostDetailDrawer,PostPreviewModal,QueueList}.tsx`

- [ ] **Step 1: Queue page header + stat cards + tabs**

Header icon tile → `bg-surface-2 text-accent ring-1 ring-border`; `<h1>Post Queue` → `.display-lg text-foreground`; subtitle → `text-faint-foreground` with "next 72 hours" count in `.mono-num`. New Post button → `bg-accent text-accent-foreground hover:brightness-110`. The gradient "Upcoming Posts" hero card → flat `Panel hover` with `mono-num text-5xl text-accent` for the count, `MicroLabel`, and the "Next in…" chip `bg-white/10 text-indigo-100` → `bg-surface-2 text-muted-foreground` (time in `.mono-num`). Platform-breakdown card → `Panel`; LinkedIn bar keeps `bg-[#0077b5]`; X bar `bg-slate-900` → `bg-grey-2`; track `bg-slate-100` → `bg-white/[0.06]`; counts `text-slate-800`→`text-foreground` + `.mono-num`; labels `text-slate-600`→`text-muted-foreground`. Tabs container `bg-slate-100` → `bg-surface`; active tab `bg-white text-slate-900 shadow-sm` → `bg-surface-2 text-foreground ring-1 ring-border`; inactive `text-slate-500 hover:text-slate-700` → `text-muted-foreground hover:text-foreground`; count badge active `bg-indigo-100 text-indigo-600` → `bg-accent/20 text-accent`, inactive `bg-slate-200/70 text-slate-400` → `bg-white/[0.06] text-faint-foreground`, both `.mono-num` (already `tabular-nums`).

- [ ] **Step 2: Read + restyle QueueList, PostDetailDrawer, PostPreviewModal**

Read each. QueueList rows → `panel`/`bg-surface` with hairline dividers `divide-border`. Drawer + Modal: backdrop `bg-black/...` keep/darken; panel surface `bg-white` → `bg-surface-2` (modals use higher surface) with `border-border`; all `slate`/`indigo` → tokens as established; timestamps/counts `.mono-num`. Preserve open/close logic and props.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green.

```bash
git add "web/app/(app)/queue/"
git commit -m "feat(web): redesign queue + drawer/modal for Obsidian theme"
```

---

## Task 13: Settings (layout + autopilot, brand, connections, personas, schedule)

**Files:**
- Modify: `web/app/(app)/settings/layout.tsx`
- Modify: `web/app/(app)/settings/autopilot/page.tsx` + `_components/CadenceForm.tsx`
- Modify: `web/app/(app)/settings/brand/page.tsx`
- Modify: `web/app/(app)/settings/connections/page.tsx`
- Modify: `web/app/(app)/settings/personas/**` (page.tsx, new/page.tsx, [id]/page.tsx, [id]/voice/page.tsx, [id]/connections/page.tsx, _components/DeletePersonaButton.tsx)
- Modify: `web/app/(app)/settings/schedule/page.tsx`

- [ ] **Step 1: Settings layout (nav/tabs)**

Read `settings/layout.tsx`. Restyle its section nav: active item → `bg-surface-2 text-foreground ring-1 ring-border` (or accent left-bar like sidebar); `text-slate-*` → tokens; container `bg-white` → `bg-surface`. Title → `.display-lg`.

- [ ] **Step 2: Restyle each settings page + components**

Read each file. Apply the standard sweep (same mapping as Task 11 Step 2): white→surface/panel, slate→foreground/muted/faint, indigo/violet→accent, status colors→success/warning/destructive tints, numbers→`.mono-num`. Form fields should use the restyled `Input`/`Textarea`/`Label` primitives where already used; where pages hardcode field classes (like login does), apply `bg-surface border-input text-foreground placeholder:text-faint-foreground focus:ring-ring`. `DeletePersonaButton` destructive action → `text-destructive`/`bg-destructive/10`. Persona avatar colors (inline `avatar_color`) are preserved.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green.

```bash
git add "web/app/(app)/settings/"
git commit -m "feat(web): redesign settings pages for Obsidian theme"
```

---

## Task 14: Profile + onboarding

**Files:**
- Modify: `web/app/(app)/profile/page.tsx` + `_components/{DisplayNameEditor,SignOutButton}.tsx`
- Modify: `web/app/(app)/onboarding/page.tsx` + `_components/{BrandStep,ConnectStep,TestPostStep}.tsx`

- [ ] **Step 1: Read all files**

Read profile page + its 2 components, onboarding page + its 3 step components.

- [ ] **Step 2: Apply the sweep**

Same mapping as prior tasks. Profile: title → `.display-lg`, cards → `Panel`, stats/dates → `.mono-num`. `SignOutButton` → neutral/destructive token. Onboarding steps: stepper indicators active → `bg-accent text-accent-foreground`, inactive → `bg-surface-2 text-faint-foreground ring-1 ring-border`; cards → `Panel`; CTA buttons → `bg-accent text-accent-foreground hover:brightness-110`; all slate/indigo → tokens. Preserve all logic/handlers.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green.

```bash
git add "web/app/(app)/profile/" "web/app/(app)/onboarding/"
git commit -m "feat(web): redesign profile + onboarding for Obsidian theme"
```

---

## Task 15: Auth pages + error pages

**Files:**
- Modify: `web/app/(auth)/layout.tsx`
- Modify: `web/app/(auth)/login/page.tsx`
- Modify: `web/app/(auth)/signup/page.tsx`
- Modify: `web/app/error.tsx`
- Modify: `web/app/global-error.tsx`

- [ ] **Step 1: Auth layout — accent grid hero**

In `(auth)/layout.tsx`: outer `bg-slate-950` stays (already dark) → change to `bg-background`. The left panel radial `rgba(99,102,241,...)`/`rgba(37,99,235,...)` indigo/blue → accent: `radial-gradient(circle at 15% 20%, oklch(0.66 0.21 32 / 0.20), transparent 45%), radial-gradient(circle at 80% 80%, oklch(0.66 0.21 32 / 0.12), transparent 50%), linear-gradient(180deg, var(--background) 0%, var(--surface) 100%)`. Grid overlay `bg-[url('/grid.svg')]` keep (or replace with `grid-bg`). Logo tile `bg-white/15` → `bg-surface-2 ring-1 ring-border text-accent`. Headline → `.display-lg text-foreground`. Uppercase label `text-indigo-200/70` → `text-accent/80`. Platform chips `border-white/20 bg-white/8` → `border-border bg-surface-2`.

- [ ] **Step 2: Login + signup forms**

In `login/page.tsx` (and mirror in `signup/page.tsx`): card `border-white/15 bg-white` → `panel-2 border-border` (dark card on dark — use `bg-surface-2`). "Welcome back" label `text-indigo-500` → `text-accent`. Title `text-slate-900` → `text-foreground` (`.display-lg` optional). Body `text-slate-500` → `text-muted-foreground`. Google button `border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50` → `border-border text-foreground hover:border-border-strong hover:bg-white/[0.04]`. Divider `border-slate-200`/`bg-white`/`text-slate-400` → `border-border`/`bg-surface-2`/`text-faint-foreground`. Inputs `border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-indigo-100` → `border-input bg-surface text-foreground placeholder:text-faint-foreground focus:border-accent focus:ring-ring/40`. Labels `text-slate-500` → `text-muted-foreground`. Error `border-red-200 bg-red-50 text-red-600` → `border-destructive/30 bg-destructive/10 text-destructive`. Submit button gradient `from-indigo-600 to-violet-600` → `bg-accent text-accent-foreground hover:brightness-110`. Footer link `text-indigo-600` → `text-accent`.

- [ ] **Step 3: Error pages**

Read `error.tsx` + `global-error.tsx`. Note: `global-error.tsx` renders its own `<html><body>` (it replaces the root layout on a global crash), so it must set dark colors inline/explicitly — give the body `bg-background text-foreground` or inline style `background:#0A0A0B;color:#F4F4F5`. Restyle both: surfaces → dark, retry button → accent, text → tokens.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm test`
Expected: clean + green. Visually check /login.

```bash
git add "web/app/(auth)/" web/app/error.tsx web/app/global-error.tsx
git commit -m "feat(web): redesign auth + error pages for Obsidian theme"
```

---

## Task 16: Residual-class sweep + final verification

**Files:**
- Potentially any web file flagged by the grep.

- [ ] **Step 1: Grep for residual light/hardcoded classes**

Run from repo root:
```bash
grep -rn -E "bg-white|bg-slate-(50|100|200)|text-slate-(900|800|700|600|500|400)|border-slate-|bg-indigo-|text-indigo-|from-indigo|via-indigo|to-indigo|from-violet|to-violet" web/app web/components --include="*.tsx" | grep -v "node_modules"
```
Expected: ideally empty. Allowed exceptions to leave: LinkedIn brand `bg-[#0077b5]`, the `<svg>` brand fills, any genuinely intentional white-on-accent text. For each remaining hit, decide: is it a brand color (keep) or a missed surface (fix with the standard token mapping).

- [ ] **Step 2: Fix any flagged misses**

Apply the standard mapping to each remaining file. Commit per file group as needed.

- [ ] **Step 3: Full verification gate**

Run from `web/`:
```bash
pnpm typecheck
pnpm test
pnpm build
```
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 4: Visual smoke pass**

Run `pnpm dev`, log in, and walk: dashboard → chat → campaigns → campaign detail → queue → settings → profile → login (logged out). Confirm: no light/white flashes, no layout shift on load, accent used only on actions/active/metrics, mono numbers everywhere numeric, headlines large/tight, contrast readable.

- [ ] **Step 5: Final commit**

```bash
git add -A web/
git commit -m "feat(web): final residual-class sweep for Obsidian redesign"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §2 tokens→Task 1; §2.3 type utilities→Task 1; §3 perf/skeletons→Tasks 2,5,7; §4.2 primitives→Task 3; §4.4 inventory→Tasks 4–15; §5 component direction→Tasks 6,8,9,11,12; §6 residual sweep→Task 16. All covered.
- **No render-assertion tests** by design — see verification-gate rationale in header; matches project's logic-only test suite and simplicity-first rule.
- **Type consistency:** `Panel`/`Stat`/`MicroLabel` defined in Task 3 are imported with consistent names/paths in Tasks 8+. Accent hex `#FF4D2E` and OKLCH `oklch(0.66 0.21 32)` used consistently.
- **No new dependencies**; fonts already configured. No backend/route/db changes.
