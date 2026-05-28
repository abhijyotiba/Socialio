import { NextResponse } from "next/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  assertPersonaInWorkspace,
  PersonaGuardError,
} from "@/lib/auth/persona-guard";
import { getAuthenticatedUser } from "@/lib/auth/auth-header";
import { listPublishedVariantsWithMetrics } from "@/lib/db/posts";

export async function GET(request: Request) {
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

  try {
    const variants = await listPublishedVariantsWithMetrics(
      personaId ?? undefined
    );
    return NextResponse.json(variants);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
