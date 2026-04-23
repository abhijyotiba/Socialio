import { createAdminClient } from "../supabase/admin";
import type { Database } from "./types";

export type PostMetricsRow = Database["public"]["Tables"]["post_metrics"]["Row"];
export type PostMetricsInsert = Database["public"]["Tables"]["post_metrics"]["Insert"];
export type PostMetricsUpdate = Database["public"]["Tables"]["post_metrics"]["Update"];

export async function upsertPostMetrics(
  metrics: PostMetricsInsert,
  admin?: ReturnType<typeof createAdminClient>
): Promise<PostMetricsRow> {
  const client = admin || createAdminClient();
  
  const { data, error } = await client
    .from("post_metrics")
    .upsert(metrics, {
      onConflict: "post_variant_id",
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert metrics: ${error.message}`);
  }

  return data;
}

export async function getMetricsForVariant(
  variantId: string,
  admin?: ReturnType<typeof createAdminClient>
): Promise<PostMetricsRow | null> {
  const client = admin || createAdminClient();
  
  const { data, error } = await client
    .from("post_metrics")
    .select()
    .eq("post_variant_id", variantId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch metrics: ${error.message}`);
  }

  return data || null;
}
