import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersonasForWorkspace } from "@/lib/db/personas";
import { getAccountGroupsWithMembers } from "@/lib/db/account-groups";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { GroupsManager } from "./_components/GroupsManager";

export default async function GroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const [groups, personas] = await Promise.all([
    getAccountGroupsWithMembers(workspace.workspace_id),
    getPersonasForWorkspace(workspace.workspace_id),
  ]);

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <FolderKanban className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Account Groups
          </h1>
          <p className="text-xs text-slate-400">
            Bundle personas into groups to target them together.
          </p>
        </div>
      </div>

      <GroupsManager
        initialGroups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          persona_ids: g.persona_ids,
        }))}
        personas={personas.map((p) => ({
          id: p.id,
          name: p.name,
          avatar_color: p.avatar_color,
        }))}
      />
    </div>
  );
}
