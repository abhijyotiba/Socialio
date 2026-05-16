import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersona } from "@/lib/db/personas";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Mic2, Link2, ChevronRight } from "lucide-react";
import { DeletePersonaButton } from "./_components/DeletePersonaButton";

export default async function PersonaHubPage({
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

  // Per-persona posting schedule is intentionally absent — the schedule page
  // is workspace-level today and lives in the sidebar. Add a per-persona entry
  // here when the schedule data model and UI become persona-scoped.
  const sections = [
    {
      href: `/settings/personas/${id}/voice`,
      icon: Mic2,
      label: "Voice Profile",
      description: "Brand voice and system prompt",
    },
    {
      href: `/settings/personas/${id}/connections`,
      icon: Link2,
      label: "Connected Accounts",
      description: "LinkedIn and X connections",
    },
  ];

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white shadow-sm"
          style={{ backgroundColor: persona.avatar_color }}
        >
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{persona.name}</h1>
          {persona.is_default && (
            <p className="text-xs text-slate-400">Default persona</p>
          )}
        </div>
      </div>

      {/* Section links */}
      <div className="space-y-2">
        {sections.map(({ href, icon: Icon, label, description }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{label}</p>
              <p className="text-xs text-slate-400">{description}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>
        ))}
      </div>

      {!persona.is_default && <DeletePersonaButton personaId={id} />}
    </div>
  );
}
