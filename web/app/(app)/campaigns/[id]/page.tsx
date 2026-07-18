import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCampaignWithPersonas } from "@/lib/db/campaigns";
import {
  getCampaignHeader,
  listCampaignVariants,
} from "@/lib/db/campaign-variants";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BulkReviewGrid } from "./_components/BulkReviewGrid";
import {
  AutopilotVariantList,
  type AutopilotVariant,
} from "./_components/AutopilotVariantList";

const GRID_PAGE_SIZE = 25;

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

  // Light header read first — determines kind + workspace ownership without
  // loading any variant bodies (the manual grid scales to 50 accounts).
  const header = await getCampaignHeader(id);
  if (!header || header.campaign.workspace_id !== workspace.workspace_id)
    notFound();

  const isAutopilot = header.campaign.kind === "autopilot";

  // Autopilot campaigns review per-post via the heavy getCampaignWithPersonas
  // read; manual campaigns use the paginated BulkReviewGrid. Branching here (a
  // Server Component, no hooks) keeps each path's hooks isolated.
  if (isAutopilot) {
    const campaign = await getCampaignWithPersonas(id);
    if (!campaign || campaign.workspace_id !== workspace.workspace_id) notFound();
    const autopilotVariants: AutopilotVariant[] = campaign.campaign_personas.flatMap(
      (cp) =>
        cp.variants.map((v) => ({
          id: v.post_variant_id,
          platform: v.platform,
          body: v.body,
          status: v.status,
          format: null,
          angle: null,
        }))
    );

    return (
      <div className="space-y-6 page-enter">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to campaigns
        </Link>
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
      </div>
    );
  }

  // Manual campaign → paginated bulk review grid.
  const initial = await listCampaignVariants(id, { page: 1, pageSize: GRID_PAGE_SIZE });

  return (
    <div className="space-y-6 page-enter">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to campaigns
      </Link>
      <BulkReviewGrid
        campaignId={id}
        jobId={header.campaign.ingestion_job_id ?? undefined}
        header={header}
        initialRows={initial.rows}
        initialTotal={initial.total}
        pageSize={GRID_PAGE_SIZE}
      />
    </div>
  );
}
