import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerSetAccountGroupMembers } from "@/lib/worker-client";

// Thin proxy: the worker owns group membership replacement under RLS.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json().catch(() => ({}));

  try {
    const res = await workerSetAccountGroupMembers(
      id,
      payload?.persona_ids ?? [],
      session.access_token
    );
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
