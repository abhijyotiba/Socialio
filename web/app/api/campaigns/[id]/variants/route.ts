import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCampaignHeader, listCampaignVariants } from "@/lib/db/campaign-variants";

// Read route: light paginated variant rows for the bulk review grid, under RLS.
// Params come from the query string (page, page_size, status, platform,
// persona_id, sort). Follows the auth/read shape of /api/notifications.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const { id } = await params;

  // Workspace check: the campaign header read is RLS-scoped, so a campaign in
  // another workspace returns null → 404.
  const header = await getCampaignHeader(id);
  if (!header || header.campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("page_size") ?? "25") || 25;
  const status = url.searchParams.get("status") ?? undefined;
  const platform = url.searchParams.get("platform") ?? undefined;
  const personaId = url.searchParams.get("persona_id") ?? undefined;
  const sortParam = url.searchParams.get("sort");

  // sort format: "<key>:<dir>" e.g. "status:desc"; defaults to persona:asc.
  let sort: { key: "persona" | "status" | "platform"; dir: "asc" | "desc" } | undefined;
  if (sortParam) {
    const [key, dir] = sortParam.split(":");
    if (key === "persona" || key === "status" || key === "platform") {
      sort = { key, dir: dir === "desc" ? "desc" : "asc" };
    }
  }

  const result = await listCampaignVariants(id, {
    page,
    pageSize,
    filters: { status, platform, persona_id: personaId },
    sort,
  });

  return NextResponse.json({ ...result, counts: header.counts });
}
