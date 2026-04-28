import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getActiveSocialConnections } from "@/lib/db/social-connections";

export async function GET() {
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

  const connections = await getActiveSocialConnections(workspace.workspace_id);

  return NextResponse.json({
    connections: connections.map((c) => ({
      platform: c.platform,
      username: c.platform_username,
    })),
  });
}
