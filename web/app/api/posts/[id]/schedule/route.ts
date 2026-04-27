import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";

const bodySchema = z.object({
  scheduled_at: z.string().datetime({ message: "scheduled_at must be an ISO 8601 datetime string" }),
});

export async function POST(
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

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { scheduled_at } = parsed.data;

  if (new Date(scheduled_at) <= new Date()) {
    return NextResponse.json(
      { error: "scheduled_at must be in the future" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["draft", "failed", "scheduled"].includes(variant.status)) {
    return NextResponse.json(
      { error: `Cannot schedule a variant with status '${variant.status}'` },
      { status: 409 }
    );
  }

  await updatePostVariant(id, {
    status: "scheduled",
    scheduled_at,
  });

  return NextResponse.json({ status: "scheduled", scheduled_at });
}
