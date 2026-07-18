import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getAccountGroupsWithMembers } from "@/lib/db/account-groups";
import { workerCreateAccountGroup } from "@/lib/worker-client";

// Read route: account groups (with membership) for the caller's workspace,
// under RLS.
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
    return NextResponse.json({ groups: [] });
  }

  const groups = await getAccountGroupsWithMembers(workspace.workspace_id);
  return NextResponse.json({ groups });
}

// Thin proxy: the worker owns group creation under RLS.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json().catch(() => ({}));

  try {
    const res = await workerCreateAccountGroup(payload, session.access_token);
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
