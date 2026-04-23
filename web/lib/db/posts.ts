import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
type ContentItemInsert =
  Database["public"]["Tables"]["content_items"]["Insert"];
type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];
type PostVariantInsert =
  Database["public"]["Tables"]["post_variants"]["Insert"];

export async function createContentItem(
  values: ContentItemInsert
): Promise<ContentItemRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

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

export async function createPostVariants(
  variants: PostVariantInsert[]
): Promise<PostVariantRow[]> {
  if (variants.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .insert(variants)
    .select();
  if (error) throw error;
  return data;
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
