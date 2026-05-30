"use client";

import { useSyncExternalStore } from "react";

type Props = { iso: string };

const POLL_INTERVAL_MS = 60_000;

function relativeTime(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function ClientRelativeTime({ iso }: Props) {
  const nowMs = useSyncExternalStore(
    (onStoreChange) => {
      const id = setInterval(onStoreChange, POLL_INTERVAL_MS);
      return () => clearInterval(id);
    },
    () => Date.now(),
    () => 0
  );

  if (!nowMs) {
    return <span suppressHydrationWarning>&nbsp;</span>;
  }

  return <span className="mono-num">{relativeTime(iso, nowMs)}</span>;
}
