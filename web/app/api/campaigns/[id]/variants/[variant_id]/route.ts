import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getCampaignHeader, getVariantDetail } from "@/lib/db/campaign-variants";

// Read route: on-demand full detail (body + revisions + media + source) for a
// single variant, loaded when the grid opens the VariantDrawer. Kept off the
// paginated list read so the grid never pays for full bodies.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant_id: string }> }
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

  const { id, variant_id } = await params;

  const header = await getCampaignHeader(id);
  if (!header || header.campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const detail = await getVariantDetail(variant_id);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
