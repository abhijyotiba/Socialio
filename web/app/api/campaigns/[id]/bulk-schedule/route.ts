import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerSchedulePost } from "@/lib/worker-client";

// Bulk schedule for the review grid.
//
// No dedicated worker bulk-schedule endpoint exists, so this fans out to the
// EXISTING per-variant `POST /posts/{id}/schedule` (via workerSchedulePost)
// server-side, one call per selected variant, and aggregates the results. Each
// call is independent; a failure on one variant doesn't abort the rest.
//
// Body: { post_variant_ids: string[], scheduled_at: string (ISO) }.
export async function POST(request: Request) {
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
  const scheduledAt = payload.scheduled_at ?? "";
  if (postVariantIds.length === 0) {
    return NextResponse.json({ error: "post_variant_ids required" }, { status: 400 });
  }
  if (!scheduledAt) {
    return NextResponse.json({ error: "scheduled_at required" }, { status: 400 });
  }

  const results = await Promise.all(
    postVariantIds.map(async (variantId) => {
      try {
        const res = await workerSchedulePost(
          variantId,
          scheduledAt,
          session.access_token
        );
        return { post_variant_id: variantId, ok: res.ok, status: res.status };
      } catch {
        return { post_variant_id: variantId, ok: false, status: 502 };
      }
    })
  );

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({
    requested: postVariantIds.length,
    succeeded,
    failed: postVariantIds.length - succeeded,
    results,
  });
}
