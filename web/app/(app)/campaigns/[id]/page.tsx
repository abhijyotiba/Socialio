import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCampaignWithPersonas } from "@/lib/db/campaigns";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CampaignReview } from "./_components/CampaignReview";
import {
  AutopilotVariantList,
  type AutopilotVariant,
} from "./_components/AutopilotVariantList";

export default async function CampaignDetailPage({
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

  const campaign = await getCampaignWithPersonas(id);
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) notFound();

  // Autopilot campaigns review per-post; manual campaigns use the per-persona
  // CampaignReview. Branching here (a Server Component, no hooks) keeps each
  // path's hooks isolated — the heavy realtime CampaignReview never mounts for
  // autopilot.
  const isAutopilot = campaign.kind === "autopilot";
  const autopilotVariants: AutopilotVariant[] = isAutopilot
    ? campaign.campaign_personas.flatMap((cp) =>
        cp.variants.map((v) => ({
          id: v.post_variant_id,
          platform: v.platform,
          body: v.body,
          status: v.status,
          format: null,
          angle: null,
        }))
      )
    : [];

  return (
    <div className="space-y-6 page-enter">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to campaigns
      </Link>
      {isAutopilot ? (
        <div className="space-y-4">
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              {campaign.title?.trim() || "Autopilot"}
            </h1>
            <p className="text-xs text-slate-400">
              Posts the engine generated from this asset.
            </p>
          </div>
          <AutopilotVariantList initial={autopilotVariants} />
        </div>
      ) : (
        <CampaignReview initial={campaign} />
      )}
    </div>
  );
}
