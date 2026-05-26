import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  assertPersonaInWorkspace,
  PersonaGuardError,
} from "@/lib/auth/persona-guard";
import { getAuthenticatedUser } from "@/lib/auth/auth-header";

export async function GET(request: Request) {
  const supabase = await createClient();

  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const personaId = searchParams.get("persona_id");

  if (personaId) {
    const workspace = await getWorkspaceForUser(user.id);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }
    try {
      await assertPersonaInWorkspace(personaId, workspace.workspace_id);
    } catch (err) {
      if (err instanceof PersonaGuardError) {
        return NextResponse.json({ error: "Persona not found" }, { status: 404 });
      }
      throw err;
    }
  }

  let query = supabase
    .from("post_variants")
    .select(`
      id,
      platform,
      status,
      published_at,
      persona_id,
      post_metrics (
        impressions,
        likes,
        comments,
        shares,
        last_synced_at
      )
    `)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (personaId) {
    query = query.eq("persona_id", personaId);
  }

  const { data: variants, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(variants);
}
