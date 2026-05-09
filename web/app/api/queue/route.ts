import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersona } from "@/lib/db/personas";

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const personaId = searchParams.get("persona_id");

  if (personaId) {
    const persona = await getPersona(personaId);
    if (!persona || persona.workspace_id !== workspace.workspace_id) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }
  }

  let query = supabase
    .from("post_variants")
    .select(`
      id,
      platform,
      status,
      scheduled_at,
      body,
      created_at,
      persona_id
    `)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });

  if (personaId) {
    query = query.eq("persona_id", personaId);
  }

  const { data: variants, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const formattedVariants = (variants ?? []).map((v) => ({
    ...v,
    content: v.body,
  }));

  return NextResponse.json(formattedVariants);
}
