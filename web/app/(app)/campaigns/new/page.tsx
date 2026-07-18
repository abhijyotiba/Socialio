import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersonasForWorkspace } from "@/lib/db/personas";
import { getConnectionsForWorkspace } from "@/lib/db/social-connections";
import { getAccountGroupsWithMembers } from "@/lib/db/account-groups";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Megaphone } from "lucide-react";
import { BriefComposerForm } from "./_components/BriefComposerForm";

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const personas = await getPersonasForWorkspace(workspace.workspace_id);

  // Connected platforms in the workspace (deduped, excluding rows needing
  // reauth) — mirrors /api/connections' workspace union.
  const connections = await getConnectionsForWorkspace(workspace.workspace_id);
  const connectedPlatforms = [
    ...new Set(
      connections.filter((c) => !c.needs_reauth).map((c) => c.platform)
    ),
  ];

  // Account groups are owned by a parallel task and are empty-safe. Guard at
  // runtime so a missing/failing module can't break this page — default to [].
  let groups: { id: string; name: string; persona_ids: string[] }[] = [];
  try {
    groups = await getAccountGroupsWithMembers(workspace.workspace_id);
  } catch {
    groups = [];
  }

  return (
    <div className="space-y-6 page-enter">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-indigo-600"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to campaigns
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Megaphone className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            New campaign
          </h1>
          <p className="text-xs text-slate-400">
            Write a structured brief and generate content for your personas.
          </p>
        </div>
      </div>

      <BriefComposerForm
        personas={personas}
        connectedPlatforms={connectedPlatforms}
        groups={groups}
      />
    </div>
  );
}
