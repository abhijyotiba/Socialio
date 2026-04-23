import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  getScheduleSlotsForWorkspace,
  createScheduleSlot,
  getNextSlotsForWorkspace,
} from "@/lib/db/posting-schedules";

const platformSchema = z.enum(["linkedin", "x"]);

const createSchema = z.object({
  platform: platformSchema,
  hour: z.number().int().min(0).max(23),
  minute: z.union([z.literal(0), z.literal(30)]),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1),
  timezone: z.string().min(1),
});

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
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const slot = await createScheduleSlot({
    workspace_id: workspace.workspace_id,
    ...parsed.data,
  });

  return NextResponse.json(slot, { status: 201 });
}
