import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type PostVariantRevisionRow =
  Database["public"]["Tables"]["post_variant_revisions"]["Row"];

export async function listRevisionsForVariant(
  variantId: string
): Promise<PostVariantRevisionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("post_variant_revisions")
    .select("*")
    .eq("post_variant_id", variantId)
    .order("revision_number", { ascending: false });
  return data ?? [];
}
