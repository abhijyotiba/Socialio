import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  getScheduleSlotsForWorkspace,
  getNextSlotsForWorkspace,
} from "@/lib/db/posting-schedules";
import { getPersona } from "@/lib/db/personas";
import { workerCreateScheduleSlot } from "@/lib/worker-client";

const platformSchema = z.enum(["linkedin", "x"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const platformParsed = platformSchema.safeParse(searchParams.get("platform"));
  if (!platformParsed.success) {
    return NextResponse.json(
      { error: "platform query param must be 'linkedin' or 'x'" },
      { status: 400 }
    );
  }

  const personaId = searchParams.get("persona_id");
  if (personaId) {
    const persona = await getPersona(personaId);
    if (!persona || persona.workspace_id !== workspace.workspace_id) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }
  }

  const platform = platformParsed.data;
  const [slots, next] = await Promise.all([
    getScheduleSlotsForWorkspace(workspace.workspace_id, platform),
    getNextSlotsForWorkspace(workspace.workspace_id, platform, 5),
  ]);

  return NextResponse.json({ slots, next: next.map((d) => d.toISOString()) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const res = await workerCreateScheduleSlot(payload, session.access_token);
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}

