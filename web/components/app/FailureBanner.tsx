import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { SUPPORTED_PLATFORMS } from "@/lib/constants/platforms";
import type { TerminalFailure } from "@/lib/db/post-failures";

// slug → human label, derived from the single source of truth so adding a
// platform to SUPPORTED_PLATFORMS surfaces it here without a second edit.
const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X / Twitter",
};

function platformLabel(slug: string): string {
  // Only label known platforms; fall back to the raw slug for anything else.
  return SUPPORTED_PLATFORMS.includes(slug as (typeof SUPPORTED_PLATFORMS)[number])
    ? PLATFORM_LABEL[slug] ?? slug
    : slug;
}

// Shows when one or more posts hit a terminal publish failure (retries
// exhausted or a terminal error code). Server component: callers pass the
// already-computed failures; renders nothing when the list is empty.
export function FailureBanner({ failures }: { failures: TerminalFailure[] }) {
  if (failures.length === 0) return null;

  // Per-persona/platform summary, e.g. "Acme (LinkedIn)".
  const summary = failures
    .map((f) => {
      const label = platformLabel(f.platform);
      return f.persona_name ? `${f.persona_name} (${label})` : label;
    })
    .join(" · ");

  // Deep-link to the first failing campaign when we have one, else the queue.
  const withCampaign = failures.find((f) => f.campaign_id);
  const href = withCampaign
    ? `/campaigns/${withCampaign.campaign_id}`
    : "/queue";

  const count = failures.length;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-red-800">
          {count} post{count === 1 ? "" : "s"} failed to publish
        </p>
        <p className="mt-0.5 text-[11px] text-red-700">
          {summary}. Publishing was retried and gave up — review and retry.
        </p>
      </div>
      <Link
        href={href}
        className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-red-700"
      >
        Review
      </Link>
    </div>
  );
}
