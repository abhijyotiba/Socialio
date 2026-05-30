import { describe, it, expect, vi, afterEach } from "vitest";
import { createNowStore } from "@/lib/hooks/now-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("createNowStore", () => {
  it("getSnapshot returns the SAME value across repeated calls until the store ticks", () => {
    // This is the bug guard: useSyncExternalStore calls getSnapshot every
    // render and re-renders if it changes. A snapshot of `Date.now()` computed
    // fresh each call changes every millisecond → infinite render loop.
    vi.useFakeTimers();
    const store = createNowStore(60_000);
    // Subscribe so the interval is live (matches how the hook uses it).
    const unsub = store.subscribe(() => {});

    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b); // stable between ticks — no churn

    unsub();
  });

  it("getSnapshot updates after the interval fires", () => {
    vi.useFakeTimers();
    const store = createNowStore(60_000);
    const onChange = vi.fn();
    const unsub = store.subscribe(onChange);

    const before = store.getSnapshot();
    vi.advanceTimersByTime(60_000); // one interval elapses
    const after = store.getSnapshot();

    expect(onChange).toHaveBeenCalled();
    expect(after).toBeGreaterThan(before);

    unsub();
  });

  it("getServerSnapshot is a stable constant (0) for SSR", () => {
    const store = createNowStore(60_000);
    expect(store.getServerSnapshot()).toBe(0);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
  });

  it("unsubscribe stops the interval", () => {
    vi.useFakeTimers();
    const store = createNowStore(60_000);
    const onChange = vi.fn();
    const unsub = store.subscribe(onChange);
    unsub();
    vi.advanceTimersByTime(180_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
