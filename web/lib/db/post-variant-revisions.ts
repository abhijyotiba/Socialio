import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type PostVariantRevisionRow =
  Database["public"]["Tables"]["post_variant_revisions"]["Row"];

/**
 * Insert a snapshot of the current variant body at the next revision number.
 * Pass `instruction = null` for the initial pre-regeneration baseline; pass
 * the user's instruction for subsequent regenerations.
 *
 * Caller flow for a regeneration:
 *   1. Read current `post_variants.body` and any prior revision count.
 *   2. snapshotVariantBody(...) to record the current body before changing it.
 *   3. Call worker → get new body.
 *   4. Update post_variants.body.
 */
export async function snapshotVariantBody(params: {
  variantId: string;
  workspaceId: string;
  body: string;
  instruction: string | null;
}): Promise<PostVariantRevisionRow> {
  const supabase = await createClient();

  const { data: latest } = await supabase
    .from("post_variant_revisions")
    .select("revision_number")
    .eq("post_variant_id", params.variantId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .single();

  const nextNumber = latest ? latest.revision_number + 1 : 1;

  const { data, error } = await supabase
    .from("post_variant_revisions")
    .insert({
      post_variant_id: params.variantId,
      workspace_id: params.workspaceId,
      revision_number: nextNumber,
      body: params.body,
      instruction: params.instruction,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listVariantRevisions(
  variantId: string
): Promise<PostVariantRevisionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variant_revisions")
    .select("*")
    .eq("post_variant_id", variantId)
    .order("revision_number", { ascending: false });
  if (error) return [];
  return data ?? [];
}
