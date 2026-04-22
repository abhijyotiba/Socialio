import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type PromptVersionRow =
  Database["public"]["Tables"]["prompt_versions"]["Row"];

export async function createPromptVersion(
  workspaceId: string,
  systemPrompt: string,
  createdBy: string
): Promise<PromptVersionRow> {
  const supabase = await createClient();

  const { data: latest } = await supabase
    .from("prompt_versions")
    .select("version_number")
    .eq("workspace_id", workspaceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  const nextVersion = latest ? latest.version_number + 1 : 1;

  const { data, error } = await supabase
    .from("prompt_versions")
    .insert({
      workspace_id: workspaceId,
      version_number: nextVersion,
      system_prompt: systemPrompt,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getLatestPromptVersion(
  workspaceId: string
): Promise<PromptVersionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}
