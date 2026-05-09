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

export async function getActiveSocialConnections(
  workspaceId: string
): Promise<SocialConnectionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("needs_reauth", false);
  if (error) return [];
  return data ?? [];
}

export async function upsertSocialConnection(
  values: Omit<SocialConnectionInsert, "persona_id"> & { persona_id?: string },
  // Accepts a pre-created client so the OAuth callback can pass its admin client.
  // Defaults to user-scoped client for all other callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic Supabase client
  clientOverride?: any
): Promise<SocialConnectionRow> {
  const supabase = clientOverride ?? (await createClient());
  let personaId = values.persona_id;
  if (!personaId) {
    const { data: persona } = await supabase
      .from("personas")
      .select("id")
      .eq("workspace_id", values.workspace_id)
      .eq("is_default", true)
      .single();
    if (!persona) throw new Error("No default persona found for workspace");
    personaId = persona.id;
  }
  const { data, error } = await supabase
    .from("social_connections")
    .upsert({ ...values, persona_id: personaId }, { onConflict: "persona_id,platform" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
