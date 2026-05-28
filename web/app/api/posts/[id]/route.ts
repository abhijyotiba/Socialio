import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant } from "@/lib/db/posts";
import { getVariantMedia } from "@/lib/db/post-variant-media";
import { workerPatchPost } from "@/lib/worker-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 403 });

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (variant.workspace_id !== workspace.workspace_id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const media = await getVariantMedia(id);

  // Resolve source info: post_variant → content_item → ingestion_job
  let source: {
    type: string;
    url?: string;
    text?: string;
    title?: string;
  } | null = null;

  const { data: contentItem } = await supabase
    .from("content_items")
    .select("ingestion_job_id")
    .eq("id", variant.content_item_id)
    .single();

  if (contentItem?.ingestion_job_id) {
    const { data: job } = await supabase
      .from("ingestion_jobs")
      .select("source_type, source_url, source_text, extracted_title")
      .eq("id", contentItem.ingestion_job_id)
      .single();
    if (job) {
      source = {
        type: job.source_type,
        url: job.source_url ?? undefined,
        text: job.source_text ?? undefined,
        title: job.extracted_title ?? undefined,
      };
    }
  }

  return NextResponse.json({
    id: variant.id,
    platform: variant.platform,
    body: variant.body,
    status: variant.status,
    scheduled_at: variant.scheduled_at,
    created_at: variant.created_at,
    media: media.map((m) => ({
      id: m.media_asset_id,
      cloudinary_url: m.cloudinary_url,
      resource_type: m.resource_type,
    })),
    source,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload.body !== "string") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const res = await workerPatchPost(id, payload.body, session.access_token);
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
