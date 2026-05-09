import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getActiveSocialConnections, getConnectionsForPersona } from "@/lib/db/social-connections";
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
    return NextResponse.json({ connections: [] });
  }

  const { searchParams } = new URL(request.url);
  const personaId = searchParams.get("persona_id");

  if (personaId) {
    const persona = await getPersona(personaId);
    if (!persona || persona.workspace_id !== workspace.workspace_id) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }
    const connections = await getConnectionsForPersona(personaId);
    return NextResponse.json({
      connections: connections.map((c) => ({
        platform: c.platform,
        username: c.platform_username,
        needs_reauth: c.needs_reauth,
      })),
    });
  }

  const connections = await getActiveSocialConnections(workspace.workspace_id);

  return NextResponse.json({
    connections: connections.map((c) => ({
      platform: c.platform,
      username: c.platform_username,
    })),
  });
}
