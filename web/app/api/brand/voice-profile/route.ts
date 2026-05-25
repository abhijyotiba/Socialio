import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerFetch } from "@/lib/worker-client";

// Thin proxy: the worker analyzes the pasted samples in-process and persists the
// voice profile + new prompt version + brand_configs row, all under RLS.
// Generous timeout — voice analysis is an LLM call.
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
    const res = await workerFetch("/brand/voice-profile", {
      method: "POST",
      accessToken: session.access_token,
      json: payload,
      timeoutMs: 60_000,
    });
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
