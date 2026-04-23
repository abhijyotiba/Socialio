import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get metrics joined with their variants
  const { data: variants, error } = await supabase
    .from("post_variants")
    .select(`
      id,
      platform,
      status,
      published_at,
      post_metrics (
        impressions,
        likes,
        comments,
        shares,
        last_synced_at
      )
    `)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(variants);
}
