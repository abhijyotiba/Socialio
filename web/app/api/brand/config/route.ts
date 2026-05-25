import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfigForPersona } from "@/lib/db/brand-configs";
import { getDefaultPersona } from "@/lib/db/personas";
import {
  assertPersonaInWorkspace,
  PersonaGuardError,
} from "@/lib/auth/persona-guard";
import { workerFetch } from "@/lib/worker-client";

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
  const requestedPersonaId = searchParams.get("persona_id");

  let personaId: string | null = null;
  if (requestedPersonaId) {
    try {
      await assertPersonaInWorkspace(requestedPersonaId, workspace.workspace_id);
    } catch (err) {
      if (err instanceof PersonaGuardError) {
        return NextResponse.json({ error: "Persona not found" }, { status: 404 });
      }
      throw err;
    }
    personaId = requestedPersonaId;
  } else {
    const defaultPersona = await getDefaultPersona(workspace.workspace_id);
    personaId = defaultPersona?.id ?? null;
  }

  const brandConfig = personaId
    ? await getBrandConfigForPersona(personaId)
    : null;
  if (!brandConfig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(brandConfig);
}

// Thin proxy: the worker owns the save (prompt-version mint + brand_configs
// upsert) under RLS.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));

  try {
    const res = await workerFetch("/brand/config", {
      method: "POST",
      accessToken: session.access_token,
      json: payload,
    });
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
