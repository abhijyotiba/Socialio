import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerFetch } from "@/lib/worker-client";

// Bulk schedule for the review grid.
//
// Thin proxy to the worker's variant-scoped `POST /campaigns/{id}/bulk-schedule
// { post_variant_ids, scheduled_at? }`. The worker routes the selected variants
// through assign_scheduled_times so every post gets a DISTINCT scheduled_at
// (never the same second), anchored at the caller's chosen time when provided.
//
// Body: { post_variant_ids: string[], scheduled_at?: string (ISO) }.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    post_variant_ids?: string[];
    scheduled_at?: string;
  };
  const postVariantIds = payload.post_variant_ids ?? [];
  if (postVariantIds.length === 0) {
    return NextResponse.json({ error: "post_variant_ids required" }, { status: 400 });
  }

  try {
    const res = await workerFetch(
      `/campaigns/${encodeURIComponent(id)}/bulk-schedule`,
      {
        method: "POST",
        accessToken: session.access_token,
        json: {
          post_variant_ids: postVariantIds,
          scheduled_at: payload.scheduled_at,
        },
      }
    );
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
