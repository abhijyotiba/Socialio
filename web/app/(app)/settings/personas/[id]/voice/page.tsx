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

  return <BrandSettingsForm personaId={id} />;
}
