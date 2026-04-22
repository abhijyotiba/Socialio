import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type BrandConfigRow = Database["public"]["Tables"]["brand_configs"]["Row"];
type BrandConfigInsert =
  Database["public"]["Tables"]["brand_configs"]["Insert"];

export async function getBrandConfig(
  workspaceId: string
): Promise<BrandConfigRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();
  if (error) return null;
  return data;
}

export async function upsertBrandConfig(
  values: BrandConfigInsert
): Promise<BrandConfigRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_configs")
    .upsert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}
