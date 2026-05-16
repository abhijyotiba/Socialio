import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getDefaultPersona } from "@/lib/db/personas";
import { redirect } from "next/navigation";

// /settings/connections is retained as a deep-link target but no longer
// renders a page of its own — social connections are per-persona (Phase
// V2.2). Land users on the default persona's connections; multi-persona
// workspaces navigate from /settings/personas.
export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const defaultPersona = await getDefaultPersona(workspace.workspace_id);
  if (!defaultPersona) redirect("/settings/personas");
  redirect(`/settings/personas/${defaultPersona.id}/connections`);
}
