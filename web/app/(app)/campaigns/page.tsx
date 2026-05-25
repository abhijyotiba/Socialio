import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { listCampaignsForWorkspace } from "@/lib/db/campaigns";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, ChevronRight } from "lucide-react";
import { ClientRelativeTime } from "./_components/ClientRelativeTime";

const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-50 text-amber-700",
  generation_partial: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
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

  return (
    <div className="space-y-6 page-enter">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Inbox className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Campaigns
          </h1>
          <p className="text-xs text-slate-400">
            Review and approve content generated for each persona.
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">No campaigns yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Generate content from the{" "}
            <Link href="/chat" className="text-indigo-600 hover:underline">
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
                className="flex items-center gap-4 rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {c.title?.trim() || "Untitled campaign"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {c.persona_count} persona{c.persona_count !== 1 ? "s" : ""}
                    {c.pending_count > 0 ? ` · ${c.pending_count} pending` : ""}
                    {" · "}
                    <ClientRelativeTime iso={c.created_at} />
                  </p>
                </div>
                <span
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-semibold ${
                    STATUS_TONE[c.status] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
