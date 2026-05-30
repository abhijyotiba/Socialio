import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export interface LowFuelPlatform {
  platform: string;
  reservoir: number;
  threshold: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X / Twitter",
};

// Shows when an active cadence's reservoir has fallen below its threshold —
// the proactive nudge to feed the engine BEFORE the queue runs dry. Server
// component: callers pass the already-computed low platforms; renders nothing
// when the list is empty.
export function LowFuelBanner({
  low,
  showFeedLink = true,
}: {
  low: LowFuelPlatform[];
  showFeedLink?: boolean;
}) {
  if (low.length === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-warning">Your queue is running low</p>
        <p className="mt-0.5 text-[11px] text-warning/85">
          {low
            .map(
              (l) =>
                `${PLATFORM_LABEL[l.platform] ?? l.platform}: ${l.reservoir} left`
            )
            .join(" · ")}
          . Feed the engine an asset to keep posting without a gap.
        </p>
      </div>
      {showFeedLink && (
        <Link
          href="/chat"
          className="shrink-0 rounded-lg bg-warning px-3 py-1.5 text-[11px] font-bold text-background transition hover:brightness-110"
        >
          Feed it
        </Link>
      )}
    </div>
  );
}
