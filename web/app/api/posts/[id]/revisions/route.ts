import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant } from "@/lib/db/posts";
import { workerRevertPost } from "@/lib/worker-client";

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
  if (!variant || variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }

  const { data: revisions } = await supabase
    .from("post_variant_revisions")
    .select("*")
    .eq("post_variant_id", id)
    .order("revision_number", { ascending: false });

  return NextResponse.json({ revisions: revisions ?? [] });
}

export async function POST(
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
  if (!payload || typeof payload.revision_number !== "number") {
    return NextResponse.json({ error: "Invalid revision_number" }, { status: 400 });
  }

  try {
    const res = await workerRevertPost(
      id,
      payload.revision_number,
      session.access_token
    );
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}

