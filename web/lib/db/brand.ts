import { createClient } from "@/lib/supabase/server";

export async function getBrandConfig(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();
  if (error) return null;
  return data;
}
