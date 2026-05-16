import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersona } from "@/lib/db/personas";
import { notFound, redirect } from "next/navigation";
import { BrandSettingsForm } from "@/components/settings/BrandSettingsForm";

export default async function PersonaVoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const persona = await getPersona(id);
  if (!persona || persona.workspace_id !== workspace.workspace_id) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: persona.avatar_color }}
        >
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Editing voice for
          </p>
          <p className="text-sm font-bold text-slate-900">{persona.name}</p>
        </div>
      </div>
      <BrandSettingsForm personaId={id} />
    </div>
  );
}
