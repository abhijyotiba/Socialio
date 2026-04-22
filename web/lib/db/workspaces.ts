import { createClient } from "@/lib/supabase/server";

export async function getWorkspaceForUser(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, created_at)")
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data;
}
