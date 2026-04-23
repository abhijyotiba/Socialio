import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";

export async function POST(
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
  if (variant.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only scheduled variants can be cancelled" },
      { status: 409 }
    );
  }

  await updatePostVariant(id, {
    status: "cancelled",
    scheduled_at: null,
  });

  return NextResponse.json({ status: "cancelled" });
}
