# Spine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the core content path (idea/URL → generate → review → schedule/publish) work end-to-end on one consistent, fast, polished review surface.

**Architecture:** Front-end-only changes in `web/`. The Python worker already always creates a campaign and returns `campaign_id` for both single- and multi-persona generation (`worker/routes/campaigns.py:149-303`), so the "single vs multi persona" fork is a pure front-end illusion we delete. Chat becomes the generate entry point and auto-navigates to `/campaigns/[id]`, which becomes the single actionable review surface reusing decomposed variant components. No worker, schema, API-route, or dependency changes.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, Supabase realtime, Vitest (node env, pure-logic tests only — no live Supabase, no component render tests per existing convention).

---

## File Structure

**New files:**
- `web/lib/chat/parse-input.ts` — extracted pure `parseInput()` (currently inline in chat page). Unit-testable.
- `web/lib/posts/variant-actions.ts` — pure state-machine helpers for the variant action lifecycle (`ActionState` type + transitions). Unit-testable.
- `web/components/spine/StatusBadge.tsx` — shared campaign/variant status pill (Track 4).
- `web/components/spine/PlatformChip.tsx` — shared LinkedIn/X chip + icon (Track 4).
- `web/components/spine/ErrorState.tsx` — shared recoverable error block with retry affordance (Track 2/4).
- `web/app/(app)/campaigns/[id]/_components/CampaignReview.tsx` — client island: realtime + campaign-level actions (replaces `CampaignDetail.tsx`).
- `web/app/(app)/campaigns/[id]/_components/PersonaGroup.tsx` — one persona's header/approval + its variant cards.
- `web/app/(app)/campaigns/[id]/_components/VariantCard.tsx` — SHARED actionable card (moved from chat, decomposed).
- `web/app/(app)/campaigns/[id]/_components/VariantBody.tsx` — display + copy.
- `web/app/(app)/campaigns/[id]/_components/VariantActions.tsx` — publish/schedule (slot picker + custom time).
- `web/app/(app)/campaigns/[id]/_components/RefinePanel.tsx` — quick chips + free-text rewrite.
- `web/app/(app)/campaigns/[id]/_components/RevisionHistory.tsx` — history list + revert.

**Modified:**
- `web/app/(app)/chat/page.tsx` — remove the fork; always route to `/campaigns/[id]` on generation start; use realtime, drop the 1s ingest poll.
- `web/app/(app)/campaigns/[id]/_components/CampaignDetail.tsx` — DELETED (replaced by CampaignReview + PersonaGroup).
- `web/app/(app)/campaigns/[id]/page.tsx` — render `<CampaignReview>` instead of `<CampaignDetail>`.

**Deleted:**
- `web/app/(app)/chat/_components/VariantCard.tsx` (moved to campaigns).
- `web/app/(app)/chat/_components/CampaignBatchCard.tsx` (fork removed).

**New tests:**
- `web/tests/chat.parse-input.test.ts`
- `web/tests/posts.variant-actions.test.ts`

---

## Phase 1 — Extract pure logic + unit tests (no behavior change)

### Task 1: Extract `parseInput()` into a tested module

**Files:**
- Create: `web/lib/chat/parse-input.ts`
- Test: `web/tests/chat.parse-input.test.ts`
- Modify: `web/app/(app)/chat/page.tsx` (import instead of inline def)

- [ ] **Step 1: Write the failing test**

`web/tests/chat.parse-input.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseInput } from "@/lib/chat/parse-input";

describe("parseInput()", () => {
  it("returns null url and full text as angle when no URL present", () => {
    expect(parseInput("Why AI startups fold")).toEqual({
      url: null,
      angle: "Why AI startups fold",
    });
  });

  it("extracts the first URL and treats the remainder as the angle", () => {
    expect(parseInput("https://x.com/a make it skeptical")).toEqual({
      url: "https://x.com/a",
      angle: "make it skeptical",
    });
  });

  it("returns empty angle for a bare URL", () => {
    expect(parseInput("https://x.com/a")).toEqual({
      url: "https://x.com/a",
      angle: "",
    });
  });

  it("trims surrounding whitespace from the angle", () => {
    expect(parseInput("  topic only  ")).toEqual({
      url: null,
      angle: "topic only",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run tests/chat.parse-input.test.ts`
Expected: FAIL — cannot resolve `@/lib/chat/parse-input`.

- [ ] **Step 3: Write minimal implementation**

`web/lib/chat/parse-input.ts`:
```typescript
// Pulls the first URL out of free text. The remainder (URL stripped, trimmed)
// is the user's angle/instruction. No URL → the whole text is the angle.
export function parseInput(text: string): { url: string | null; angle: string } {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return { url: null, angle: text.trim() };
  const url = match[0];
  const angle = text.replace(url, "").trim();
  return { url, angle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run tests/chat.parse-input.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Update chat page to import it**

In `web/app/(app)/chat/page.tsx`: delete the inline `parseInput` function (lines ~39-47) and add at the top with the other imports:
```typescript
import { parseInput } from "@/lib/chat/parse-input";
```

- [ ] **Step 6: Verify typecheck + tests**

Run: `cd web && pnpm typecheck && pnpm vitest run tests/chat.parse-input.test.ts`
Expected: typecheck clean, tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/chat/parse-input.ts web/tests/chat.parse-input.test.ts "web/app/(app)/chat/page.tsx"
git commit -m "refactor(web): extract parseInput into tested module"
```

---

### Task 2: Extract variant action-state machine into a tested module

This pulls the `ActionState` type and its transition rules out of the 553-line `VariantCard` so the lifecycle is testable in `node` env without rendering React.

**Files:**
- Create: `web/lib/posts/variant-actions.ts`
- Test: `web/tests/posts.variant-actions.test.ts`

- [ ] **Step 1: Write the failing test**

`web/tests/posts.variant-actions.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  isBusy,
  isTerminal,
  showIdleActions,
  type ActionState,
} from "@/lib/posts/variant-actions";

describe("variant action-state helpers", () => {
  it("treats in-flight states as busy", () => {
    for (const kind of ["publishing", "loadingSlots", "scheduling", "cancelling"] as const) {
      expect(isBusy({ kind } as ActionState)).toBe(true);
    }
    expect(isBusy({ kind: "idle" })).toBe(false);
  });

  it("treats published/scheduled/cancelled as terminal", () => {
    expect(isTerminal({ kind: "published", url: "u" })).toBe(true);
    expect(isTerminal({ kind: "scheduled", scheduledAt: "t" })).toBe(true);
    expect(isTerminal({ kind: "cancelled" })).toBe(true);
    expect(isTerminal({ kind: "idle" })).toBe(false);
  });

  it("shows idle actions only when not terminal and not picking a time/slot", () => {
    expect(showIdleActions({ kind: "idle" })).toBe(true);
    expect(showIdleActions({ kind: "error", message: "x" })).toBe(true);
    expect(showIdleActions({ kind: "pickingSlot", nextSlots: [] })).toBe(false);
    expect(showIdleActions({ kind: "pickingTime" })).toBe(false);
    expect(showIdleActions({ kind: "published", url: "u" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run tests/posts.variant-actions.test.ts`
Expected: FAIL — cannot resolve `@/lib/posts/variant-actions`.

- [ ] **Step 3: Write minimal implementation**

`web/lib/posts/variant-actions.ts`:
```typescript
export type ActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "loadingSlots" }
  | { kind: "pickingSlot"; nextSlots: string[] }
  | { kind: "pickingTime" }
  | { kind: "scheduling" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const BUSY_KINDS = ["publishing", "loadingSlots", "scheduling", "cancelling"];
const TERMINAL_KINDS = ["published", "scheduled", "cancelled"];

export function isBusy(state: ActionState): boolean {
  return BUSY_KINDS.includes(state.kind);
}

export function isTerminal(state: ActionState): boolean {
  return TERMINAL_KINDS.includes(state.kind);
}

export function showIdleActions(state: ActionState): boolean {
  return (
    !isTerminal(state) &&
    state.kind !== "pickingSlot" &&
    state.kind !== "pickingTime"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run tests/posts.variant-actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/posts/variant-actions.ts web/tests/posts.variant-actions.test.ts
git commit -m "refactor(web): extract variant action-state machine into tested module"
```

---

## Phase 2 — Shared design-system primitives (Track 4, spine-scoped)

### Task 3: StatusBadge primitive

**Files:**
- Create: `web/components/spine/StatusBadge.tsx`

- [ ] **Step 1: Write the component**

`web/components/spine/StatusBadge.tsx`:
```typescript
const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-50 text-amber-700",
  generation_partial: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${
        STATUS_TONE[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/components/spine/StatusBadge.tsx
git commit -m "feat(web): add shared StatusBadge spine primitive"
```

---

### Task 4: PlatformChip + ErrorState primitives

**Files:**
- Create: `web/components/spine/PlatformChip.tsx`
- Create: `web/components/spine/ErrorState.tsx`

- [ ] **Step 1: Write PlatformChip**

`web/components/spine/PlatformChip.tsx`:
```typescript
import type { ReactNode } from "react";

const PLATFORM: Record<string, { label: string; bg: string; text: string; icon: ReactNode }> = {
  linkedin: {
    label: "LinkedIn",
    bg: "bg-[#0077b5]",
    text: "text-[#0077b5]",
    icon: (
      <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  x: {
    label: "X / Twitter",
    bg: "bg-slate-900",
    text: "text-slate-700",
    icon: (
      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
};

export function PlatformChip({ platform }: { platform: string }) {
  const cfg = PLATFORM[platform];
  if (!cfg) {
    return (
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">
        {platform}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.bg}`}>
        {cfg.icon}
      </span>
      <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${cfg.text}`}>
        {cfg.label}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Write ErrorState**

`web/components/spine/ErrorState.tsx`:
```typescript
type Props = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorState({ message, onRetry, onDismiss }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-xs text-red-600">{message}</p>
      <div className="flex shrink-0 items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] font-semibold text-red-700 hover:underline"
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/components/spine/PlatformChip.tsx web/components/spine/ErrorState.tsx
git commit -m "feat(web): add shared PlatformChip and ErrorState spine primitives"
```

---

## Phase 3 — Move & decompose the actionable VariantCard

The card and its sub-pieces move from `chat/_components/` to `campaigns/[id]/_components/` because after Phase 4 only the campaign surface renders them. Decompose while moving.

### Task 5: Move VariantCard + MediaPicker to the campaign surface (no decomposition yet)

**Files:**
- Create: `web/app/(app)/campaigns/[id]/_components/VariantCard.tsx` (copy of current chat VariantCard, with import paths fixed)
- Create: `web/app/(app)/campaigns/[id]/_components/MediaPicker.tsx` (copy of current chat MediaPicker)

- [ ] **Step 1: Copy MediaPicker**

Copy `web/app/(app)/chat/_components/MediaPicker.tsx` verbatim to `web/app/(app)/campaigns/[id]/_components/MediaPicker.tsx`. No content change (it uses `@/` imports only).

- [ ] **Step 2: Copy VariantCard and rewire its imports**

Copy `web/app/(app)/chat/_components/VariantCard.tsx` to `web/app/(app)/campaigns/[id]/_components/VariantCard.tsx`. Change:
- `import { MediaPicker } from "./MediaPicker";` stays (now resolves to the new sibling copy).
- Replace the inline `ActionState` type definition with:
```typescript
import { isBusy, isTerminal, showIdleActions, type ActionState } from "@/lib/posts/variant-actions";
```
- Delete the local `const isBusy = ...`, `const isTerminal = ...`, `const showIdleActions = ...` lines (~255-257) and use the imported functions: replace `isBusy` usages with `isBusy(state)`, `isTerminal` with `isTerminal(state)`, `showIdleActions` with `showIdleActions(state)`.

- [ ] **Step 3: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean (both the old chat copy and the new campaign copy compile; old copy is deleted in Phase 4).

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/_components/VariantCard.tsx" "web/app/(app)/campaigns/[id]/_components/MediaPicker.tsx"
git commit -m "refactor(web): move actionable VariantCard to campaign surface"
```

---

### Task 6: Decompose VariantCard into VariantBody / VariantActions / RefinePanel / RevisionHistory

Split the 553-line card into focused pieces. The parent `VariantCard` owns shared state and composes children.

**Files:**
- Create: `web/app/(app)/campaigns/[id]/_components/VariantBody.tsx`
- Create: `web/app/(app)/campaigns/[id]/_components/VariantActions.tsx`
- Create: `web/app/(app)/campaigns/[id]/_components/RefinePanel.tsx`
- Create: `web/app/(app)/campaigns/[id]/_components/RevisionHistory.tsx`
- Modify: `web/app/(app)/campaigns/[id]/_components/VariantCard.tsx`

- [ ] **Step 1: Create VariantBody (display + copy)**

`web/app/(app)/campaigns/[id]/_components/VariantBody.tsx`:
```typescript
import { useState } from "react";
import { Copy, CheckCheck } from "lucide-react";
import { PlatformChip } from "@/components/spine/PlatformChip";

type Props = { platform: string; body: string; revisionNumber: number | null };

export function VariantBody({ platform, body, revisionNumber }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <PlatformChip platform={platform} />
          {revisionNumber !== null && (
            <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500 ring-1 ring-inset ring-indigo-200">
              v{revisionNumber}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-700"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
          ) : (
            <><Copy className="h-3.5 w-3.5" />Copy</>
          )}
        </button>
      </div>
      <div className="px-4 py-3.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create RefinePanel (quick chips + free-text rewrite)**

`web/app/(app)/campaigns/[id]/_components/RefinePanel.tsx`:
```typescript
import { Loader2, Sparkles } from "lucide-react";

const QUICK_ACTIONS = ["Shorter", "Longer", "More personal", "Less corporate", "Change hook", "Add CTA", "Add question"];

type Props = {
  instruction: string;
  onInstructionChange: (v: string) => void;
  onRegenerate: (instruction: string) => void;
  regenerating: boolean;
  regenError: string | null;
};

export function RefinePanel({ instruction, onInstructionChange, onRegenerate, regenerating, regenError }: Props) {
  return (
    <div className="border-t border-slate-100 px-4 py-3 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(action)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40"
          >
            {action}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onRegenerate(instruction);
            }
          }}
          placeholder="Describe what to change…"
          disabled={regenerating}
          className="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onRegenerate(instruction)}
          disabled={!instruction.trim() || regenerating}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {regenerating ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {regenError && <p className="text-xs text-red-500">{regenError}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create RevisionHistory (history list + revert)**

`web/app/(app)/campaigns/[id]/_components/RevisionHistory.tsx`:
```typescript
import { Loader2, RotateCcw } from "lucide-react";

export interface Revision {
  revision_number: number;
  body: string;
  instruction: string | null;
  created_at: string;
}

type Props = {
  loading: boolean;
  revisions: Revision[];
  reverting: number | null;
  onRevert: (revNum: number) => void;
};

export function RevisionHistory({ loading, revisions, reverting, onRevert }: Props) {
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
        </p>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-slate-400">No revision history yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Revision history</p>
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {revisions.map((rev) => (
              <div key={rev.revision_number} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-600">
                    v{rev.revision_number}
                    {rev.instruction && <span className="ml-1.5 font-normal text-slate-400">— {rev.instruction}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={reverting !== null}
                    onClick={() => onRevert(rev.revision_number)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                  >
                    {reverting === rev.revision_number ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Revert
                  </button>
                </div>
                <p className="line-clamp-2 leading-relaxed text-slate-500">{rev.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create VariantActions (publish/schedule footer)**

`web/app/(app)/campaigns/[id]/_components/VariantActions.tsx`:
```typescript
import { CheckCheck, ExternalLink, Loader2, Zap, CalendarClock } from "lucide-react";
import { useNowPlusMinutes } from "@/lib/hooks/useNowPlusMinutes";
import { ErrorState } from "@/components/spine/ErrorState";
import { isBusy, showIdleActions, type ActionState } from "@/lib/posts/variant-actions";

type Props = {
  state: ActionState;
  setState: (s: ActionState) => void;
  scheduledAt: string;
  setScheduledAt: (v: string) => void;
  regenerating: boolean;
  onPublish: () => void;
  onScheduleClick: () => void;
  onScheduleAt: (utcIso: string) => void;
  onScheduleConfirm: () => void;
  onCancel: () => void;
};

export function VariantActions({
  state, setState, scheduledAt, setScheduledAt, regenerating,
  onPublish, onScheduleClick, onScheduleAt, onScheduleConfirm, onCancel,
}: Props) {
  const minScheduleTime = useNowPlusMinutes(1);

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
      {state.kind === "published" && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
            <CheckCheck className="h-4 w-4" /> Published
          </span>
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
            View post <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {state.kind === "scheduled" && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
            <CalendarClock className="h-3.5 w-3.5" />
            Scheduled for {new Date(state.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
          <button onClick={onCancel} disabled={isBusy(state)} className="text-[11px] font-medium text-red-400 transition hover:text-red-600 disabled:opacity-50">
            Cancel
          </button>
        </div>
      )}

      {state.kind === "cancelled" && <p className="text-xs text-slate-400">Post cancelled and moved to drafts.</p>}

      {state.kind === "cancelling" && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Cancelling…</p>
      )}

      {state.kind === "error" && (
        <ErrorState message={state.message} onDismiss={() => setState({ kind: "idle" })} />
      )}

      {state.kind === "pickingSlot" && (
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Pick a time slot</p>
          <div className="flex flex-wrap gap-1.5">
            {state.nextSlots.map((slot) => (
              <button key={slot} onClick={() => onScheduleAt(slot)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600">
                {new Date(slot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setState({ kind: "pickingTime" })} className="text-[11px] font-semibold text-indigo-600 hover:underline">Custom time →</button>
            <button onClick={() => setState({ kind: "idle" })} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {state.kind === "pickingTime" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={minScheduleTime}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <button onClick={onScheduleConfirm} disabled={!scheduledAt} className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40">Confirm</button>
            <button onClick={() => setState({ kind: "idle" })} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
          <p className="text-[11px] text-slate-400">
            Configure slots in <a href="/settings/schedule" className="font-medium text-indigo-600 hover:underline">Settings</a> for one-click scheduling.
          </p>
        </div>
      )}

      {showIdleActions(state) && (
        <div className="flex items-center gap-2">
          <button onClick={onPublish} disabled={isBusy(state) || regenerating} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-40">
            {state.kind === "publishing" ? <><Loader2 className="h-3 w-3 animate-spin" /> Publishing…</> : <><Zap className="h-3 w-3" /> Publish now</>}
          </button>
          <button onClick={onScheduleClick} disabled={isBusy(state) || regenerating} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40">
            {state.kind === "loadingSlots" ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</> : <><CalendarClock className="h-3 w-3" /> Schedule</>}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite VariantCard to compose the four children**

Replace the body of `web/app/(app)/campaigns/[id]/_components/VariantCard.tsx` so it keeps all the async handlers and state but delegates rendering. The handlers (`handlePublishNow`, `handleScheduleClick`, `scheduleAt`, `handleScheduleConfirm`, `handleCancel`, `handleRegenerate`, `handleQuickAction`, `loadRevisions`, `toggleHistory`, `handleRevert`) stay identical to the current implementation. The JSX becomes:

```typescript
"use client";

import { useState, memo } from "react";
import { Loader2, RotateCcw, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { MediaPicker } from "./MediaPicker";
import { VariantBody } from "./VariantBody";
import { VariantActions } from "./VariantActions";
import { RefinePanel } from "./RefinePanel";
import { RevisionHistory, type Revision } from "./RevisionHistory";
import { showIdleActions, type ActionState } from "@/lib/posts/variant-actions";

type Variant = { id: string; platform: string; body: string };

export const VariantCard = memo(function VariantCard({ variant, jobId }: { variant: Variant; jobId?: string }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");
  const [currentBody, setCurrentBody] = useState(variant.body);
  const [showRefine, setShowRefine] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);

  async function handlePublishNow() {
    setState({ kind: "publishing" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setState({ kind: "error", message: data.error ?? "Publish failed." }); return; }
      setState({ kind: "published", url: data.platform_post_url });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleClick() {
    setState({ kind: "loadingSlots" });
    try {
      const res = await fetch(`/api/schedule-slots?platform=${variant.platform}`);
      if (!res.ok) throw new Error();
      const body = await res.json();
      const next: string[] = body.next ?? [];
      setState(next.length > 0 ? { kind: "pickingSlot", nextSlots: next.slice(0, 3) } : { kind: "pickingTime" });
    } catch {
      setState({ kind: "pickingTime" });
    }
  }

  async function scheduleAt(utcIso: string) {
    setState({ kind: "scheduling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: utcIso }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMessage =
          data.error?.formErrors?.[0] ??
          (typeof data.error === "string" ? data.error : null) ??
          "Schedule failed.";
        setState({ kind: "error", message: errorMessage });
        return;
      }
      setState({ kind: "scheduled", scheduledAt: data.scheduled_at });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleConfirm() {
    if (!scheduledAt) return;
    const utcDate = new Date(scheduledAt).toISOString();
    if (new Date(utcDate) <= new Date()) {
      setState({ kind: "error", message: "Scheduled time must be in the future." });
      return;
    }
    await scheduleAt(utcDate);
  }

  async function handleCancel() {
    setState({ kind: "cancelling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setState({ kind: "error", message: data.error ?? "Cancel failed." });
        return;
      }
      setState({ kind: "cancelled" });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleRegenerate(instr: string) {
    if (!instr.trim()) return;
    setRegenError(null);
    setRegenerating(true);
    try {
      const res = await fetch(`/api/posts/${variant.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error ?? "Regeneration failed. Please try again.");
        return;
      }
      setCurrentBody(data.body);
      setRevisionNumber(data.revision_number);
      setInstruction("");
      setShowRefine(false);
      setRevisions([]);
      setShowHistory(false);
    } catch {
      setRegenError("Network error. Please try again.");
    } finally {
      setRegenerating(false);
    }
  }

  async function loadRevisions() {
    if (loadingRevisions) return;
    setLoadingRevisions(true);
    try {
      const res = await fetch(`/api/posts/${variant.id}/revisions`);
      const data = await res.json();
      if (res.ok) setRevisions(data.revisions ?? []);
    } finally {
      setLoadingRevisions(false);
    }
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && revisions.length === 0) await loadRevisions();
  }

  async function handleRevert(revNum: number) {
    setReverting(revNum);
    try {
      const res = await fetch(`/api/posts/${variant.id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_number: revNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error ?? "Revert failed.");
        return;
      }
      setCurrentBody(data.body);
      setRevisionNumber(data.revision_number);
      setRevisions([]);
      setShowHistory(false);
    } finally {
      setReverting(null);
    }
  }

  const idle = showIdleActions(state);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md hover:border-indigo-200/60">
      <VariantBody platform={variant.platform} body={currentBody} revisionNumber={revisionNumber} />

      {idle && showRefine && (
        <RefinePanel
          instruction={instruction}
          onInstructionChange={setInstruction}
          onRegenerate={handleRegenerate}
          regenerating={regenerating}
          regenError={regenError}
        />
      )}

      {revisionNumber !== null && showHistory && (
        <RevisionHistory loading={loadingRevisions} revisions={revisions} reverting={reverting} onRevert={handleRevert} />
      )}

      {idle && <MediaPicker variantId={variant.id} jobId={jobId} />}

      <VariantActions
        state={state}
        setState={setState}
        scheduledAt={scheduledAt}
        setScheduledAt={setScheduledAt}
        regenerating={regenerating}
        onPublish={handlePublishNow}
        onScheduleClick={handleScheduleClick}
        onScheduleAt={scheduleAt}
        onScheduleConfirm={handleScheduleConfirm}
        onCancel={handleCancel}
      />

      {idle && (
        <div className="flex items-center justify-end gap-1.5 border-t border-slate-100 bg-slate-50/50 px-4 pb-3">
          {revisionNumber !== null && (
            <button type="button" onClick={toggleHistory} disabled={regenerating} title="Revision history"
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40">
              <RotateCcw className="h-3 w-3" />
              {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={() => { setShowRefine((v) => !v); setRegenError(null); }} disabled={regenerating}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition disabled:opacity-40 ${showRefine ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"}`}>
            <Sparkles className="h-3 w-3" /> Refine
          </button>
        </div>
      )}
    </div>
  );
});
```

> Note: when copying the handlers verbatim, keep their bodies exactly as in the original `chat/_components/VariantCard.tsx` (Task 5 copy). Remove the now-unused `Loader2`/`Copy`/etc. imports that moved into children; keep only what the parent JSX above references. Run typecheck to catch leftover unused imports.

- [ ] **Step 6: Verify typecheck + existing tests**

Run: `cd web && pnpm typecheck && pnpm vitest run tests/posts.variant-actions.test.ts`
Expected: clean + PASS. Fix any unused-import lint errors flagged by typecheck.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/_components/VariantBody.tsx" "web/app/(app)/campaigns/[id]/_components/VariantActions.tsx" "web/app/(app)/campaigns/[id]/_components/RefinePanel.tsx" "web/app/(app)/campaigns/[id]/_components/RevisionHistory.tsx" "web/app/(app)/campaigns/[id]/_components/VariantCard.tsx"
git commit -m "refactor(web): decompose VariantCard into focused subcomponents"
```

---

## Phase 4 — Rebuild the campaign review surface (Track 1 core: fixes the read-only bug)

### Task 7: Create PersonaGroup (persona header + approval + actionable variant cards)

**Files:**
- Create: `web/app/(app)/campaigns/[id]/_components/PersonaGroup.tsx`

- [ ] **Step 1: Write PersonaGroup**

`web/app/(app)/campaigns/[id]/_components/PersonaGroup.tsx`:
```typescript
import type { CampaignWithPersonas } from "@/lib/db/campaigns";
import { VariantCard } from "./VariantCard";

type CampaignPersona = CampaignWithPersonas["campaign_personas"][number];

type Props = {
  cp: CampaignPersona;
  jobId?: string;
  isGenerating: boolean;
  pendingAction: string | null;
  voiceChanged: boolean;
  onApprove: (personaId: string) => void;
  onReject: (personaId: string) => void;
};

export function PersonaGroup({ cp, jobId, isGenerating, pendingAction, voiceChanged, onApprove, onReject }: Props) {
  const approveBusy = pendingAction === `approve-${cp.persona.id}`;
  const rejectBusy = pendingAction === `reject-${cp.persona.id}`;
  const lockedOut = pendingAction !== null;

  return (
    <li className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: cp.persona.avatar_color }}>
            {cp.persona.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{cp.persona.name}</p>
            <p className="text-[10px] text-slate-400">{cp.variants.length} variant{cp.variants.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {cp.approval_status === "pending" && !isGenerating && cp.variants.length > 0 && (
          <div className="flex gap-2">
            <button type="button" onClick={() => onReject(cp.persona.id)} disabled={lockedOut}
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:opacity-50">
              {rejectBusy ? "Rejecting…" : "Reject"}
            </button>
            <button type="button" onClick={() => onApprove(cp.persona.id)} disabled={lockedOut}
              className="inline-flex h-8 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {approveBusy ? "Approving…" : "Approve"}
            </button>
          </div>
        )}
        {cp.approval_status === "approved" && <span className="text-xs font-semibold text-emerald-600">✓ Approved</span>}
        {cp.approval_status === "rejected" && <span className="text-xs text-slate-400">Rejected</span>}
      </div>

      {voiceChanged && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          This persona&apos;s voice profile has been updated since these variants were generated. Regenerate if you want the latest voice.
        </div>
      )}

      {isGenerating && cp.variants.length === 0 && <p className="text-xs text-slate-400">Generating…</p>}

      {cp.generation_error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{cp.generation_error}</p>
      )}

      <div className="space-y-3">
        {cp.variants.map((v) => (
          <VariantCard key={v.id} variant={{ id: v.post_variant_id, platform: v.platform, body: v.body }} jobId={jobId} />
        ))}
      </div>
    </li>
  );
}
```

> Critical: `VariantCard` receives `id: v.post_variant_id` — the publish/schedule/regenerate routes act on the **post_variant** id, not the `campaign_persona_variants` row id. This is the substantive fix that makes the campaign surface actionable.

- [ ] **Step 2: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/_components/PersonaGroup.tsx"
git commit -m "feat(web): add actionable PersonaGroup for campaign review"
```

---

### Task 8: Create CampaignReview island (replaces CampaignDetail)

Carries over all the campaign-level logic from `CampaignDetail.tsx` (realtime, delete, cancel-scheduled, approve-all/persona, stuck-generating watchdog, voiceChanged), but renders `PersonaGroup` (actionable) instead of read-only boxes, and uses the shared `StatusBadge`.

**Files:**
- Create: `web/app/(app)/campaigns/[id]/_components/CampaignReview.tsx`

- [ ] **Step 1: Write CampaignReview**

Copy `CampaignDetail.tsx` to `CampaignReview.tsx` and make these changes:
1. Rename the exported function `CampaignDetail` → `CampaignReview`.
2. Replace the inline `STATUS_LABEL`/`STATUS_TONE` status-pill markup (lines ~298-304) with `<StatusBadge status={campaign.status} />` and add `import { StatusBadge } from "@/components/spine/StatusBadge";`. Delete the now-unused local `STATUS_LABEL`/`STATUS_TONE` consts.
3. Replace the entire `<ul>…</ul>` persona list (lines ~428-548) — including the inline `voiceChanged` computation per persona — with:
```typescript
      <ul className="space-y-3">
        {campaign.campaign_personas.map((cp) => {
          const bc = cp.persona.brand_configs;
          const currentPromptVersion = Array.isArray(bc)
            ? bc[0]?.current_prompt_version_id ?? null
            : bc?.current_prompt_version_id ?? null;
          const voiceChanged =
            currentPromptVersion !== null &&
            cp.variants.length > 0 &&
            cp.variants.every(
              (v) => v.prompt_version_id !== null && v.prompt_version_id !== currentPromptVersion
            );
          return (
            <PersonaGroup
              key={cp.id}
              cp={cp}
              jobId={campaign.ingestion_job_id ?? undefined}
              isGenerating={isGeneratingNow}
              pendingAction={pendingAction}
              voiceChanged={voiceChanged}
              onApprove={approvePersona}
              onReject={rejectPersona}
            />
          );
        })}
      </ul>
```
4. Add `import { PersonaGroup } from "./PersonaGroup";` at the top.

> `campaign.ingestion_job_id` is a column on the campaign row (`CampaignRow`), available on `CampaignWithPersonas`. It threads the source media into each card's `MediaPicker`.

- [ ] **Step 2: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/_components/CampaignReview.tsx"
git commit -m "feat(web): add CampaignReview island with actionable persona groups"
```

---

### Task 9: Point the campaign page at CampaignReview, delete CampaignDetail

**Files:**
- Modify: `web/app/(app)/campaigns/[id]/page.tsx`
- Delete: `web/app/(app)/campaigns/[id]/_components/CampaignDetail.tsx`

- [ ] **Step 1: Swap the import + usage**

In `web/app/(app)/campaigns/[id]/page.tsx`:
- Change `import { CampaignDetail } from "./_components/CampaignDetail";` → `import { CampaignReview } from "./_components/CampaignReview";`
- Change `<CampaignDetail initial={campaign} />` → `<CampaignReview initial={campaign} />`

- [ ] **Step 2: Delete the old component**

```bash
git rm "web/app/(app)/campaigns/[id]/_components/CampaignDetail.tsx"
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd web && pnpm typecheck`
Expected: clean (no remaining references to CampaignDetail).

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/campaigns/[id]/page.tsx"
git commit -m "refactor(web): render CampaignReview on campaign page; remove CampaignDetail"
```

---

## Phase 5 — Unify chat flow: always route to the campaign (Track 1 + Track 2)

### Task 10: Auto-navigate chat to /campaigns/[id] and remove the inline fork

**Files:**
- Modify: `web/app/(app)/chat/page.tsx`
- Delete: `web/app/(app)/chat/_components/VariantCard.tsx`
- Delete: `web/app/(app)/chat/_components/CampaignBatchCard.tsx`

- [ ] **Step 1: Remove the multi-persona branch and route on every generation**

In `web/app/(app)/chat/page.tsx`:

1. Add `import { useRouter } from "next/navigation";` and inside the component: `const router = useRouter();`
2. Delete the `ChatMessage` union members `"ai-variants"` and `"ai-campaign"` (lines ~35-36) and the `Variant`/`Media` types only if unused after edits (keep `Media`; it's used by `ai-extracted`).
3. Delete `buildGenerationResult()` entirely.
4. Replace the body of `callCampaigns`'s consumers: in both `handlePromptOnly` and `handleGenerate`, after a successful `callCampaigns`, replace the `buildGenerationResult(...)`/`replaceMessage` logic with navigation:
```typescript
      const campaignId = data.campaign_id;
      if (!campaignId) {
        // worker returned 200 without an id — surface as error
        replaceMessage(generatingId, { id: generatingId, type: "ai-error", message: "Generation did not return a campaign." });
        return;
      }
      router.push(`/campaigns/${campaignId}`);
      return;
```
   (Remove the `isMultiPersona` branching; both paths now navigate. Keep the typing/`ai-generating` placeholder shown until navigation.)
5. Remove the `VariantCard`, `CampaignBatchCard` imports and their render branches (`msg.type === "ai-variants"`, `msg.type === "ai-campaign"`) from the messages map.
6. The single-persona 502 case (`success_count == 0`) returns `{ error, campaign_id }`; the existing `!ok` path already shows the error. Leave that.

- [ ] **Step 2: Delete the moved/forked components**

```bash
git rm "web/app/(app)/chat/_components/VariantCard.tsx" "web/app/(app)/chat/_components/CampaignBatchCard.tsx"
```

- [ ] **Step 3: Verify no dangling references**

Run: `cd web && pnpm typecheck`
Expected: clean. If typecheck flags an unused `Variant` type or `PersonaRow`/`Media`, remove only the genuinely unused ones.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/chat/page.tsx"
git commit -m "feat(web): unify chat to always route to the campaign review surface"
```

---

### Task 11: Replace the 1-second ingest poll with the existing realtime channel

The chat extraction flow currently polls `GET /api/ingest/{job_id}` every 1000ms (the dominant perceived-lag source). Replace with a Supabase realtime subscription on `ingestion_jobs`, mirroring the generation subscription already in the file (lines ~101-129).

**Files:**
- Modify: `web/app/(app)/chat/page.tsx`

- [ ] **Step 1: Replace the polling loop in `handleSubmit`**

In the URL branch of `handleSubmit`, after `setActiveJobId(data.job_id)`, **remove** the entire `while (...)` polling block (the `await fetch(\`/api/ingest/${data.job_id}\`)` loop, ~lines 229-264 and 266-283). Replace the extraction-progress + completion handling with a realtime subscription that resolves a promise on terminal stage:

```typescript
      const finalJob = await new Promise<{
        stage: string;
        extracted_title?: string;
        extracted_text?: string;
        media?: Media[];
        error?: string;
      }>((resolve, reject) => {
        const supabase = createClient();
        const timeout = setTimeout(() => {
          supabase.removeChannel(channel);
          reject(new Error("Extraction timed out."));
        }, 60000);

        const INGEST_STAGE_LABELS: Record<string, string> = {
          pending: "Starting ingestion...",
          scraping: "Scraping URL...",
          uploading_media: "Uploading media assets...",
        };

        const channel = supabase
          .channel(`ingest-${data.job_id}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "ingestion_jobs", filter: `id=eq.${data.job_id}` },
            (payload) => {
              const job = payload.new as { stage: string; extracted_title?: string; extracted_text?: string; media?: Media[]; error?: string };
              if (job.stage === "done" || job.stage === "failed") {
                clearTimeout(timeout);
                supabase.removeChannel(channel);
                resolve(job);
              } else {
                replaceMessage(typingId, { id: typingId, type: "ai-typing", label: INGEST_STAGE_LABELS[job.stage] ?? "Extracting content..." });
              }
            }
          )
          .subscribe();
      });

      if (finalJob.stage === "failed") {
        replaceMessage(typingId, { id: typingId, type: "ai-error", message: finalJob.error ?? "Extraction failed." });
        return;
      }

      replaceMessage(typingId, {
        id: typingId,
        type: "ai-extracted",
        jobId: data.job_id,
        title: finalJob.extracted_title || "",
        text: finalJob.extracted_text || "",
        media: finalJob.media || [],
        userAngle: angle || undefined,
      });
```

> Edge case: if the job already completed before the channel subscribed (fast scrape), the UPDATE may have fired already. Guard by doing one `GET /api/ingest/${data.job_id}` immediately after subscribe; if its stage is terminal, resolve right away. Add that single fetch (not a loop) inside `.subscribe(async (status) => { if (status === "SUBSCRIBED") { /* one-shot check */ } })`.

- [ ] **Step 2: Verify typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean. Confirm `createClient` from `@/lib/supabase/client` is imported (it already is).

- [ ] **Step 3: Manual smoke (documented, not automated — requires live worker)**

Per CLAUDE.md tests must not need live Supabase, so this is a manual checklist for the implementer running locally:
- Paste a URL in chat → progress labels update via realtime, no 1s network spam in DevTools Network tab.
- On done → extraction card appears → Generate → navigates to `/campaigns/[id]`.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/chat/page.tsx"
git commit -m "perf(web): replace 1s ingest polling with realtime subscription"
```

---

## Phase 6 — Final verification

### Task 12: Full typecheck + test + manual spine walk-through

- [ ] **Step 1: Full typecheck**

Run: `cd web && pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `cd web && pnpm test`
Expected: all green, including the two new test files.

- [ ] **Step 3: Manual end-to-end (local, two terminals — worker + web)**

Walk the success criteria from the spec:
1. Single persona: chat → URL → extract → Generate → lands on `/campaigns/[id]` → publish/schedule/refine all work.
2. Multi persona: select 2+ personas → Generate → same campaign surface → every persona's variants are actionable (this was the read-only bug).
3. DevTools Network: no 1s polling during extraction.
4. Force a failure (disconnect platform) → error states show with recover/dismiss.

- [ ] **Step 4: Commit any fixes, then finish the branch**

If the manual walk-through surfaced fixes, commit them with appropriate `fix(web):` messages. Then invoke `superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Notes for the implementer

- **Do not touch the worker, schema, or any `/api` route file.** Every endpoint this plan needs already exists. The whole change is `web/` UI + two `web/lib` pure modules.
- **No new dependencies.** Everything uses existing `lucide-react`, Tailwind, Supabase client.
- **post_variant id vs campaign_persona_variant id:** publish/schedule/regenerate/revisions/cancel routes all act on the `post_variants.id`. In `CampaignWithPersonas`, that is `variant.post_variant_id`. Task 7 passes exactly that. Getting this wrong = 404s on every action.
- **Realtime gotcha:** the `replaceMessage`/`setMessages` closures inside the subscription callback must reference stable ids (`typingId`, `data.job_id`) captured in the handler scope — they are, in the Task 11 code.
