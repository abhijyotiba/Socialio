// A useSyncExternalStore-compatible "current time" store.
//
// THE BUG THIS FIXES: a naive `useNowMs` used `() => Date.now()` as its
// getSnapshot. useSyncExternalStore calls getSnapshot on EVERY render and
// re-renders whenever the value changes (Object.is). Date.now() returns a new
// value every call → React re-renders forever → "Maximum update depth
// exceeded". The snapshot MUST be cached and only change when the store ticks.
//
// Here getSnapshot returns a cached timestamp that is only refreshed inside the
// interval callback (and pushed to subscribers), so it's stable between ticks.

export interface NowStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => number;
  getServerSnapshot: () => number;
}

export function createNowStore(intervalMs: number): NowStore {
  let now = Date.now();

  return {
    subscribe(onChange: () => void) {
      const id = setInterval(() => {
        now = Date.now();
        onChange();
      }, intervalMs);
      return () => clearInterval(id);
    },
    // Stable between ticks: returns the cached value, NOT a fresh Date.now().
    getSnapshot: () => now,
    // SSR: a constant so server and client first render agree.
    getServerSnapshot: () => 0,
  };
}
