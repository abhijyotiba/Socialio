import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerIngest } from "@/lib/worker-client";

// Thin proxy: auth gate + forward the user's Supabase JWT to the worker, which
// owns ingestion (validation, rate-limiting, job creation, scraping, DB writes)
// and runs every query under that JWT so RLS enforces workspace isolation.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const workerRes = await workerIngest(payload, session.access_token);
    const data = await workerRes
      .json()
      .catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: workerRes.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
