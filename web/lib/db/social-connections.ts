import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type SocialConnectionRow =
  Database["public"]["Tables"]["social_connections"]["Row"];
type SocialConnectionInsert =
  Database["public"]["Tables"]["social_connections"]["Insert"];

export async function getSocialConnection(
  workspaceId: string,
  platform: "linkedin" | "x"
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .single();
  if (error) return null;
  return data;
}

export async function upsertSocialConnection(
  values: SocialConnectionInsert,
  // Accepts a pre-created client so the OAuth callback can pass its admin client.
  // Defaults to user-scoped client for all other callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic Supabase client
  clientOverride?: any
): Promise<SocialConnectionRow> {
  const supabase = clientOverride ?? (await createClient());
  const { data, error } = await supabase
    .from("social_connections")
    .upsert(values, { onConflict: "workspace_id,platform" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
