import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/db/types";

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

/**
 * Persist a voice profile + bump the timestamp. Caller is responsible for
 * inserting the corresponding `prompt_versions` row and updating
 * `current_prompt_version_id` (do that in the same route, not here, so they
 * stay coupled at the call site).
 */
export async function setVoiceProfile(
  workspaceId: string,
  profile: Json
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_configs")
    .update({
      voice_profile: profile,
      voice_profile_updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

export async function getVoiceProfile(
  workspaceId: string
): Promise<{ profile: Json | null; updated_at: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brand_configs")
    .select("voice_profile, voice_profile_updated_at")
    .eq("workspace_id", workspaceId)
    .single();
  return {
    profile: data?.voice_profile ?? null,
    updated_at: data?.voice_profile_updated_at ?? null,
  };
}
