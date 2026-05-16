import { useState } from "react";

/**
 * Returns an ISO-local datetime string for "now + N minutes", computed once
 * on mount. Used as the `min` attribute on schedule pickers so users can't
 * pick a time in the past.
 *
 * Slight staleness is acceptable: if a user keeps the picker open for hours
 * the displayed minimum lags real time, but the backend rejects past times
 * anyway. Computing this in render directly (a previous version did) tripped
 * the React Compiler's purity rule and broke memoization.
 */
export function useNowPlusMinutes(minutes: number): string {
  const [value] = useState(() =>
    new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 16)
  );
  return value;
}
