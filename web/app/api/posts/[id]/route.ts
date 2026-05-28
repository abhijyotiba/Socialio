import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, getVariantSource } from "@/lib/db/posts";
import { getVariantMedia } from "@/lib/db/post-variant-media";
import { workerPatchPost } from "@/lib/worker-client";

const patchSchema = z.object({
  body: z.string().min(1).max(10_000),
});

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

  const [media, source] = await Promise.all([
    getVariantMedia(id),
    getVariantSource(variant.content_item_id),
  ]);

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

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const res = await workerPatchPost(id, parsed.data.body, session.access_token);
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
