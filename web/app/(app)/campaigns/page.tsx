import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { listCampaignsForWorkspace } from "@/lib/db/campaigns";
import { getCadencesForWorkspace, getReservoirForPersona } from "@/lib/db/content-engine";
import { LowFuelBanner, type LowFuelPlatform } from "@/components/app/LowFuelBanner";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, ChevronRight, Zap } from "lucide-react";
import { ClientRelativeTime } from "./_components/ClientRelativeTime";

const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-surface-2 text-muted-foreground",
  pending_approval: "bg-warning/15 text-warning",
  generation_partial: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export default async function CampaignsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const campaigns = await listCampaignsForWorkspace(workspace.workspace_id, 50);

  // Low-fuel nudge: warn when an active cadence's reservoir is below threshold.
  const cadences = await getCadencesForWorkspace(workspace.workspace_id);
  const activeCadences = cadences.filter((c) => c.active);
  const reservoirs = await Promise.all(
    activeCadences.map((c) => getReservoirForPersona(c.persona_id, c.platform))
  );
  const low: LowFuelPlatform[] = activeCadences.flatMap((c, i) =>
    reservoirs[i] < c.low_reservoir_threshold
      ? [{ platform: c.platform, reservoir: reservoirs[i], threshold: c.low_reservoir_threshold }]
      : []
  );

  return (
    <div className="space-y-6 page-enter">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-inset ring-border">
          <Inbox className="h-5 w-5" />
        </div>
        <div>
          <h1 className="display-lg text-3xl text-foreground">
            Campaigns
          </h1>
          <p className="text-xs text-faint-foreground">
            Review and approve content generated for each persona.
          </p>
        </div>
      </div>

      <LowFuelBanner low={low} />

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="text-sm font-semibold text-foreground">No campaigns yet</p>
          <p className="mt-1 text-xs text-faint-foreground">
            Generate content from the{" "}
            <Link href="/chat" className="text-accent hover:underline">
              Chat
            </Link>{" "}
            and it will appear here for approval.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                href={`/campaigns/${c.id}`}
                className="flex items-center gap-4 p-4 panel panel-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                    {c.kind === "autopilot" && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                        <Zap className="h-2.5 w-2.5" /> Autopilot
                      </span>
                    )}
                    {c.title?.trim() || "Untitled campaign"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint-foreground">
                    <span className="mono-num">{c.persona_count}</span> persona{c.persona_count !== 1 ? "s" : ""}
                    {c.pending_count > 0 ? ` · ${c.pending_count} pending` : ""}
                    {" · "}
                    <ClientRelativeTime iso={c.created_at} />
                  </p>
                </div>
                <span
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-semibold ${
                    STATUS_TONE[c.status] ?? "bg-surface-2 text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                <ChevronRight className="h-4 w-4 text-faint-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
