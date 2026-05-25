import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerRegeneratePost } from "@/lib/worker-client";

// Thin proxy: forward the user's JWT to the worker, which owns regeneration
// (brand load, revision snapshots, the LLM call, and the body update) under RLS.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const workerRes = await workerRegeneratePost(
      id,
      payload,
      session.access_token
    );
    const data = await workerRes
      .json()
      .catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: workerRes.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
