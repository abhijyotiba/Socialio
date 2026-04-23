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

  // Get scheduled variants
  const { data: variants, error } = await supabase
    .from("post_variants")
    .select(`
      id,
      platform,
      status,
      scheduled_at,
      content,
      content_metadata,
      created_at
    `)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true }); // Soonest first

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(variants);
}
