import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];

export async function getPostVariant(
  id: string
): Promise<PostVariantRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

// Slim shape used by the queue page — body/scheduled_at, no joins.
export type ScheduledVariantRow = Pick<
  PostVariantRow,
  "id" | "platform" | "status" | "scheduled_at" | "body" | "created_at" | "persona_id"
>;

// Scheduled variants for a workspace, optionally narrowed to a single persona.
// RLS handles workspace scoping; the optional personaId argument applies an
// extra filter for the per-persona queue view.
export async function listScheduledVariants(
  personaId?: string
): Promise<ScheduledVariantRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("post_variants")
    .select("id, platform, status, scheduled_at, body, created_at, persona_id")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });
  if (personaId) query = query.eq("persona_id", personaId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// post_metrics has a unique FK on post_variant_id, so PostgREST embeds it as
// a nullable single object rather than an array.
export type PublishedVariantWithMetrics = Pick<
  PostVariantRow,
  "id" | "platform" | "status" | "published_at" | "persona_id"
> & {
  post_metrics: {
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    last_synced_at: string;
  } | null;
};

// Published variants joined with their metrics. Workspace scoping is handled
// by RLS; the optional personaId narrows the result for per-persona views.
export async function listPublishedVariantsWithMetrics(
  personaId?: string
): Promise<PublishedVariantWithMetrics[]> {
  const supabase = await createClient();
  let query = supabase
    .from("post_variants")
    .select(
      `
      id,
      platform,
      status,
      published_at,
      persona_id,
      post_metrics (
        impressions,
        likes,
        comments,
        shares,
        last_synced_at
      )
    `
    )
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (personaId) query = query.eq("persona_id", personaId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PublishedVariantWithMetrics[];
}

// Count of post_variants in a given status for a workspace. RLS scopes the
// query; the explicit workspace_id filter keeps the eq() in place since some
// callers pre-resolved the workspace.
export async function countVariantsByStatus(
  workspaceId: string,
  status: "scheduled" | "published" | "draft"
): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("post_variants")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", status);
  return count ?? 0;
}

export type VariantSource = {
  type: string;
  url?: string;
  text?: string;
  title?: string;
};

// Resolve the ingestion source for a variant by walking
// post_variant → content_item → ingestion_job. Returns null when the variant
// has no upstream ingestion job (e.g. prompt-only generations may not).
export async function getVariantSource(
  contentItemId: string
): Promise<VariantSource | null> {
  const supabase = await createClient();
  const { data: contentItem } = await supabase
    .from("content_items")
    .select("ingestion_job_id")
    .eq("id", contentItemId)
    .single();

  if (!contentItem?.ingestion_job_id) return null;

  const { data: job } = await supabase
    .from("ingestion_jobs")
    .select("source_type, source_url, source_text, extracted_title")
    .eq("id", contentItem.ingestion_job_id)
    .single();

  if (!job) return null;

  return {
    type: job.source_type,
    url: job.source_url ?? undefined,
    text: job.source_text ?? undefined,
    title: job.extracted_title ?? undefined,
  };
}
