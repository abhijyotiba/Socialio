import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant } from "@/lib/db/posts";
import { getVariantMedia } from "@/lib/db/post-variant-media";
import { workerUpdatePostMedia } from "@/lib/worker-client";

const putSchema = z.object({
  media_asset_ids: z.array(z.string().uuid()).max(4),
});

export async function GET(
  _request: Request,
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
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assets = await getVariantMedia(id);
  return NextResponse.json({
    assets: assets.map((a) => ({
      id: a.media_asset_id,
      cloudinary_url: a.cloudinary_url,
      resource_type: a.resource_type,
    })),
  });
}

export async function PUT(
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

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const res = await workerUpdatePostMedia(
      id,
      parsed.data.media_asset_ids,
      session.access_token
    );
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}

