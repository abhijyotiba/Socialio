import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  getPostVariant,
  updatePostVariant,
} from "@/lib/db/posts";
import { snapshotVariantBody } from "@/lib/db/post-variant-revisions";
import { getBrandConfigForPersona } from "@/lib/db/brand-configs";
// Legacy fallback for pre-persona variants that still carry NULL persona_id.
// eslint-disable-next-line no-restricted-imports -- intentional fallback for legacy variants; remove once all variants are persona-scoped
import { getBrandConfig } from "@/lib/db/_legacy/brand-configs";
import {
  WorkerError,
  workerRegenerate,
} from "@/lib/worker-client";

const bodySchema = z.object({
  instruction: z.string().min(1).max(500),
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

  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json());
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

  // Don't regenerate posts that have left the editable lifecycle.
  if (
    variant.status !== "draft" &&
    variant.status !== "scheduled" &&
    variant.status !== "failed"
  ) {
    return NextResponse.json(
      {
        error: `Can't regenerate a post that's ${variant.status}.`,
      },
      { status: 409 }
    );
  }

  // Persona-scoped brand is the new contract; fall back to workspace-default
  // for pre-persona variants that still carry NULL persona_id.
  const brand = variant.persona_id
    ? await getBrandConfigForPersona(variant.persona_id)
    : await getBrandConfig(workspace.workspace_id);
  if (!brand?.custom_system_prompt) {
    return NextResponse.json(
      {
        error:
          "Set up your brand voice in Settings before regenerating posts.",
      },
      { status: 400 }
    );
  }

  // Optional grounding context: pull the source summary from content_items if
  // present, so the model can re-reference facts rather than inventing them.
  let summary: string | null = null;
  const { data: contentItem } = await supabase
    .from("content_items")
    .select("summary")
    .eq("id", variant.content_item_id)
    .single();
  summary = contentItem?.summary ?? null;

  // Snapshot current body BEFORE calling the worker. If the worker fails we
  // still have the snapshot, but the variant body remains the canonical
  // current value — no half-state. Snapshotting first also makes the first
  // regeneration's revision_number = 1 carry the original, so the diff log
  // is complete.
  await snapshotVariantBody({
    variantId: variant.id,
    workspaceId: workspace.workspace_id,
    body: variant.body,
    instruction: null,
  });

  let workerResp;
  try {
    workerResp = await workerRegenerate({
      workspace_id: workspace.workspace_id,
      variant_id: variant.id,
      platform: variant.platform as "linkedin" | "x",
      current_body: variant.body,
      instruction: parsed.data.instruction,
      brand_system_prompt: brand.custom_system_prompt,
      summary,
    });
  } catch (err) {
    if (err instanceof WorkerError) {
      return NextResponse.json(
        { error: "Regeneration is temporarily unavailable. Please try again." },
        { status: 502 }
      );
    }
    throw err;
  }

  // Persist the new body. The instruction is recorded on the *next* snapshot
  // taken on the next regeneration — i.e. the snapshot above is "what the body
  // was BEFORE this regeneration"; revision_number n+1 will carry the new body.
  await updatePostVariant(variant.id, {
    body: workerResp.body,
  });

  // Also snapshot the new body alongside the instruction so the history is
  // self-contained without requiring readers to reconcile current vs. log.
  const newSnapshot = await snapshotVariantBody({
    variantId: variant.id,
    workspaceId: workspace.workspace_id,
    body: workerResp.body,
    instruction: parsed.data.instruction,
  });

  return NextResponse.json({
    body: workerResp.body,
    revision_number: newSnapshot.revision_number,
  });
}
