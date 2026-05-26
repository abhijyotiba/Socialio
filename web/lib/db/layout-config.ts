import { createClient } from "@/lib/supabase/server";

export async function getLayoutConfig(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspace_members")
    .select(`
      workspace_id,
      role,
      workspaces (
        id,
        name,
        created_at,
        personas (
          id,
          name,
          is_default,
          brand_configs (
            id
          )
        )
      )
    `)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  // PostgREST returns nested objects or arrays for related tables.
  const workspacesData = data.workspaces as any;
  const personas = workspacesData?.personas || [];
  const defaultPersona = personas.find((p: any) => p.is_default) || null;
  const brandConfig = defaultPersona?.brand_configs?.[0] || null;

  return {
    workspace: {
      workspace_id: data.workspace_id,
      role: data.role,
      workspaces: workspacesData,
    },
    defaultPersona,
    brandConfig,
  };
}
