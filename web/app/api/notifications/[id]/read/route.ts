import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerMarkNotificationRead } from "@/lib/worker-client";

// Thin proxy: marking a notification read is a user write, so it goes through
// the worker (RLS + validation), never a direct web write.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await workerMarkNotificationRead(id, session.access_token);
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
