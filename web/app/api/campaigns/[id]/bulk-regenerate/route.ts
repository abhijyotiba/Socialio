import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerRegeneratePost } from "@/lib/worker-client";
import { filterVariantIdsForCampaign } from "@/lib/db/campaign-variants";

// Bulk regenerate for the review grid.
//
// No dedicated worker bulk-regenerate endpoint exists, so this fans out to the
// EXISTING per-variant `POST /posts/{id}/regenerate` (via workerRegeneratePost)
// server-side, one call per selected variant, and aggregates the results. Each
// call is independent; a failure on one variant doesn't abort the rest.
//
// Selected ids are first scoped to THIS campaign (like the approve/schedule
// bulk paths) so a stale/crafted request can't regenerate another campaign's
// variants in the same workspace.
//
// Body: { post_variant_ids: string[], instruction: string }.
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
    instruction?: string;
  };
  const requestedIds = payload.post_variant_ids ?? [];
  const instruction = (payload.instruction ?? "").trim();
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: "post_variant_ids required" }, { status: 400 });
  }
  if (!instruction) {
    return NextResponse.json({ error: "instruction required" }, { status: 400 });
  }

  // Drop any ids that don't belong to this campaign before fanning out.
  const postVariantIds = await filterVariantIdsForCampaign(id, requestedIds);
  if (postVariantIds.length === 0) {
    return NextResponse.json(
      { error: "No variants in the selection for this campaign" },
      { status: 404 }
    );
  }

  const results = await Promise.all(
    postVariantIds.map(async (variantId) => {
      try {
        const res = await workerRegeneratePost(
          variantId,
          { instruction },
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
