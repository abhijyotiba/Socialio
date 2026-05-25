import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerFetch } from "@/lib/worker-client";

// Thin proxy: the worker owns the publish path — idempotency guard, Vault token
// read (service-role), media upload, the LinkedIn/X call, and publish_attempts.
// Generous timeout: media upload + the platform API call can be slow.
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
    const res = await workerFetch(
      `/posts/${encodeURIComponent(id)}/publish`,
      { method: "POST", accessToken: session.access_token, timeoutMs: 60_000 }
    );
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
