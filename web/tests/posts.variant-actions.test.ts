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
