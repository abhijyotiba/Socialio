import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerGetIngestion } from "@/lib/worker-client";

// Thin proxy: forward the user's JWT to the worker, which reads the job under
// RLS (a foreign job_id is invisible and returns 404). Preserves the original
// flat { ...job, media } response shape.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job_id } = await params;

  try {
    const workerRes = await workerGetIngestion(job_id, session.access_token);
    const data = await workerRes
      .json()
      .catch(() => ({ error: "Worker error" }));
    if (!workerRes.ok) {
      return NextResponse.json(data, { status: workerRes.status });
    }
    return NextResponse.json({ ...data.job, media: data.media });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
