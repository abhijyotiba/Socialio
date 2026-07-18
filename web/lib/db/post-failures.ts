import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

// Light row for the terminal-failure banner. One entry per post_variant that
// hit a terminal publish failure (status = 'failed_terminal'), carrying just
// enough to render the summary + link: the failing persona, the platform, the
// error code, and the owning campaign (for /campaigns/{id}).
export interface TerminalFailure {
  post_variant_id: string;
  persona_name: string;
  avatar_color: string;
  platform: string;
  error_code: string;
  campaign_id: string | null;
}

// Shape returned by PostgREST for the embedded joins. Both the persona and the
// campaign chain can come back either as a single object or as a one-element
// array depending on how the relationship is inferred, so we accept both.
type EmbeddedPersona =
  | { name: string; avatar_color: string }
  | Array<{ name: string; avatar_color: string }>
  | null;

type EmbeddedCampaignLink = {
  campaign_personas:
    | { campaign_id: string }
    | Array<{ campaign_id: string }>
    | null;
};

type RawTerminalFailureRow = {
  id: string;
  platform: string;
  error_code: string | null;
  persona: EmbeddedPersona;
  campaign_persona_variants: EmbeddedCampaignLink[] | null;
};

function unwrap<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// Terminal publish failures for a workspace: post_variants that ended in
// 'failed_terminal' (retries exhausted or a terminal error code) and carry a
// non-null error + error_code. Joined to the failing persona (name, colour),
// the platform, and the owning campaign id via the
// campaign_persona_variants → campaign_personas → campaign_id chain so the
// banner can deep-link to /campaigns/{id}. RLS scopes to the caller's
// workspace; the explicit eq() keeps the workspace filter visible.
export async function getTerminalFailures(
  workspaceId: string
): Promise<TerminalFailure[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .select(
      `
      id,
      platform,
      error_code,
      persona:personas ( name, avatar_color ),
      campaign_persona_variants (
        campaign_personas ( campaign_id )
      )
    `
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "failed_terminal")
    .not("error", "is", null)
    .not("error_code", "is", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawTerminalFailureRow[];

  return rows.map((row) => {
    const persona = unwrap(row.persona);
    const link = unwrap(row.campaign_persona_variants);
    const campaignPersona = link ? unwrap(link.campaign_personas) : null;
    return {
      post_variant_id: row.id,
      persona_name: persona?.name ?? "",
      avatar_color: persona?.avatar_color ?? "",
      platform: row.platform,
      error_code: row.error_code ?? "",
      campaign_id: campaignPersona?.campaign_id ?? null,
    };
  });
}

// Re-export the generated Row type for callers that need the full shape.
export type PostVariantRow =
  Database["public"]["Tables"]["post_variants"]["Row"];
