import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersona } from "@/lib/db/personas";
import { listScheduledVariants } from "@/lib/db/posts";

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

  let variants;
  try {
    variants = await listScheduledVariants(personaId ?? undefined);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }

  const formattedVariants = variants.map((v) => ({
    ...v,
    content: v.body,
  }));

  return NextResponse.json(formattedVariants);
}
