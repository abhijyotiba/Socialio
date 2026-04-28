import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";
import {
  listVariantRevisions,
  snapshotVariantBody,
} from "@/lib/db/post-variant-revisions";

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

  const revisions = await listVariantRevisions(id);
  return NextResponse.json({ revisions });
}

const revertBodySchema = z.object({
  revision_number: z.number().int().min(1),
});

/**
 * Revert: copies the body of an older revision into post_variants.body, and
 * snapshots the current body first so we never destroy history.
 */
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

  const { id } = await params;

  const parsed = revertBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const variant = await getPostVariant(id);
  if (!variant || variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (
    variant.status !== "draft" &&
    variant.status !== "scheduled" &&
    variant.status !== "failed"
  ) {
    return NextResponse.json(
      { error: `Can't revert a post that's ${variant.status}.` },
      { status: 409 }
    );
  }

  const revisions = await listVariantRevisions(id);
  const target = revisions.find(
    (r) => r.revision_number === parsed.data.revision_number
  );
  if (!target) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  // Snapshot current body before overwriting it. The instruction string makes
  // the audit trail readable: "reverted to revision N".
  await snapshotVariantBody({
    variantId: variant.id,
    workspaceId: workspace.workspace_id,
    body: variant.body,
    instruction: `reverted to revision ${target.revision_number}`,
  });

  await updatePostVariant(variant.id, { body: target.body });

  return NextResponse.json({ body: target.body });
}
