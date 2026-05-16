import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCampaignWithPersonas } from "@/lib/db/campaigns";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CampaignDetail } from "./_components/CampaignDetail";

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

  return (
    <div className="space-y-6 page-enter">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to campaigns
      </Link>
      <CampaignDetail initial={campaign} />
    </div>
  );
}
