import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];

export async function updateContentItem(
  id: string,
  patch: Partial<ContentItemRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_items")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getContentItemWithVariants(
  id: string
): Promise<{ content_item: ContentItemRow; variants: PostVariantRow[] } | null> {
  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemError || !item) return null;

  const { data: variants, error: variantsError } = await supabase
    .from("post_variants")
    .select("*")
    .eq("content_item_id", id)
    .order("created_at");
  if (variantsError) return null;

  return { content_item: item, variants: variants ?? [] };
}

export async function getPostVariant(
  id: string
): Promise<PostVariantRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function updatePostVariant(
  id: string,
  patch: Partial<PostVariantRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("post_variants")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function listContentItemsForJob(
  jobId: string
): Promise<ContentItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("ingestion_job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
