import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getIngestionJob } from "@/lib/db/ingestion";
import { getMediaAssetsForJob } from "@/lib/db/media-assets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ job_id: string }> }
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

  const { job_id } = await params;
  const job = await getIngestionJob(job_id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (job.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const media = await getMediaAssetsForJob(job_id);

  return NextResponse.json({ ...job, media });
}
