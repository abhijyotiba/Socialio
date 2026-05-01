import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type PublishAttemptRow =
  Database["public"]["Tables"]["publish_attempts"]["Row"];
type PublishAttemptInsert =
  Database["public"]["Tables"]["publish_attempts"]["Insert"];

type AnyClient = SupabaseClient<Database>;

export async function createPublishAttempt(
  values: PublishAttemptInsert,
  client?: AnyClient
): Promise<PublishAttemptRow> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("publish_attempts")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePublishAttempt(
  id: string,
  patch: Partial<PublishAttemptRow>,
  client?: AnyClient
): Promise<void> {
  const supabase = client ?? (await createClient());
  const { error } = await supabase
    .from("publish_attempts")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getLatestAttempt(
  postVariantId: string,
  client?: AnyClient
): Promise<PublishAttemptRow | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("publish_attempts")
    .select("*")
    .eq("post_variant_id", postVariantId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

// Idempotency guard: has this variant already been successfully published?
export async function hasSuccessfulAttempt(
  idempotencyKey: string,
  client?: AnyClient
): Promise<boolean> {
  const supabase = client ?? (await createClient());
  const { count, error } = await supabase
    .from("publish_attempts")
    .select("*", { count: "exact", head: true })
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "success");
  if (error) return false;
  return (count ?? 0) > 0;
}
