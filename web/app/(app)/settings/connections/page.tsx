import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getDefaultPersona } from "@/lib/db/personas";
import { ConnectionsForm } from "@/components/settings/ConnectionsForm";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const defaultPersona = await getDefaultPersona(workspace.workspace_id);
  if (!defaultPersona) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        No persona found for this workspace. Please contact support.
      </div>
    );
  }

  return (
    <Suspense>
      <ConnectionsForm personaId={defaultPersona.id} />
    </Suspense>
  );
}
