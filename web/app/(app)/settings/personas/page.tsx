import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersonasForWorkspace } from "@/lib/db/personas";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { PERSONA_SOFT_CAP, PERSONA_HARD_CAP } from "@/lib/constants/platforms";

export default async function PersonasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login");

  const personas = await getPersonasForWorkspace(workspace.workspace_id);

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Personas</h1>
            <p className="text-xs text-slate-400">Each persona has its own voice, accounts, and posting schedule.</p>
            <p className="mt-1 text-xs text-slate-400">
              {personas.length} / {PERSONA_SOFT_CAP} personas · up to{" "}
              {PERSONA_HARD_CAP} supported.
            </p>
          </div>
        </div>
        <Link
          href="/settings/personas/new"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Add Persona
        </Link>
      </div>

      {/* List */}
      <div className="space-y-2">
        {personas.map((persona) => (
          <Link
            key={persona.id}
            href={`/settings/personas/${persona.id}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30"
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: persona.avatar_color }}
            >
              {persona.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{persona.name}</p>
              {persona.is_default && (
                <p className="text-xs text-slate-400">Default</p>
              )}
            </div>
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        ))}

        {personas.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">No personas yet.</p>
        )}
      </div>
    </div>
  );
}
