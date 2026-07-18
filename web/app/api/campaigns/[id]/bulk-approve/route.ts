import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workerFetch } from "@/lib/worker-client";
import { resolvePersonaIdsForVariants } from "@/lib/db/campaign-variants";

// Bulk approve for the review grid.
//
// No dedicated worker bulk-approve endpoint exists. We reuse the EXISTING
// `POST /campaigns/{id}/approve { persona_ids }` chokepoint, which approves a
// persona's variants and assigns scheduled_at automatically. The grid selects
// post_variant_ids, so we first resolve those to their owning persona_ids
// (server-side, under RLS) and forward the persona subset to the worker.
//
// Body: { post_variant_ids: string[] }.
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
  };
  const postVariantIds = payload.post_variant_ids ?? [];
  if (postVariantIds.length === 0) {
    return NextResponse.json(
      { error: "post_variant_ids required" },
      { status: 400 }
    );
  }

  const personaIds = await resolvePersonaIdsForVariants(id, postVariantIds);
  if (personaIds.length === 0) {
    return NextResponse.json(
      { error: "No matching variants for this campaign" },
      { status: 404 }
    );
  }

  try {
    const res = await workerFetch(`/campaigns/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      accessToken: session.access_token,
      json: { persona_ids: personaIds },
    });
    const data = await res.json().catch(() => ({ error: "Worker error" }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
