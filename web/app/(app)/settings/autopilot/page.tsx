import { Zap, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getDefaultPersona } from "@/lib/db/personas";
import {
  getCadencesForWorkspace,
  getReservoirForPersona,
} from "@/lib/db/content-engine";
import { CadenceForm } from "./_components/CadenceForm";
import { LowFuelBanner, type LowFuelPlatform } from "@/components/app/LowFuelBanner";

export default async function AutopilotSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return <p className="text-sm text-slate-500">Please sign in.</p>;
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return <p className="text-sm text-slate-500">No workspace found.</p>;
  }

  const persona = await getDefaultPersona(workspace.workspace_id);
  if (!persona) {
    return (
      <p className="text-sm text-slate-500">
        Create a persona first to set up the content engine.
      </p>
    );
  }

  const cadences = await getCadencesForWorkspace(workspace.workspace_id);
  const byPlatform = (p: "linkedin" | "x") => {
    const row = cadences.find(
      (c) => c.persona_id === persona.id && c.platform === p
    );
    // DB types platform as string; narrow to the form's literal union.
    return row ? { ...row, platform: p } : null;
  };

  const [liReservoir, xReservoir] = await Promise.all([
    getReservoirForPersona(persona.id, "linkedin"),
    getReservoirForPersona(persona.id, "x"),
  ]);

  // A platform is "low" only when its cadence is active and the reservoir has
  // fallen below that cadence's threshold — the same condition the refill cron
  // nudges on.
  const low: LowFuelPlatform[] = (
    [
      ["linkedin", liReservoir],
      ["x", xReservoir],
    ] as const
  ).flatMap(([platform, reservoir]) => {
    const cadence = byPlatform(platform);
    if (cadence && cadence.active && reservoir < cadence.low_reservoir_threshold) {
      return [{ platform, reservoir, threshold: cadence.low_reservoir_threshold }];
    }
    return [];
  });

  return (
    <div className="space-y-5 page-enter">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Content Autopilot
          </h1>
          <p className="text-xs text-slate-400">
            Set it once — the engine meters your reservoir into posts at this cadence.
          </p>
        </div>
      </div>

      <LowFuelBanner low={low} />

      {/* Reservoir indicator */}
      <div className="flex flex-wrap gap-3">
        {([
          ["LinkedIn", liReservoir],
          ["X / Twitter", xReservoir],
        ] as const).map(([name, count]) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Inbox className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {count} post{count === 1 ? "" : "s"} ready
              </p>
              <p className="text-[11px] text-slate-400">{name} reservoir</p>
            </div>
          </div>
        ))}
      </div>

      <CadenceForm
        platform="linkedin"
        label="LinkedIn"
        personaId={persona.id}
        initial={byPlatform("linkedin")}
      />
      <CadenceForm
        platform="x"
        label="X / Twitter"
        personaId={persona.id}
        initial={byPlatform("x")}
      />
    </div>
  );
}
