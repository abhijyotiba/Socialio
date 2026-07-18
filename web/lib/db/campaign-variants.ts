import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import { listRevisionsForVariant } from "@/lib/db/post-variant-revisions";
import { getVariantMedia, type MediaSelection } from "@/lib/db/post-variant-media";
import { getVariantSource, type VariantSource } from "@/lib/db/posts";
import { isApprovedStatus, type GridVariantRow } from "@/lib/campaigns/grid";

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
type PostVariantRevisionRow =
  Database["public"]["Tables"]["post_variant_revisions"]["Row"];

// ── Header ──────────────────────────────────────────────────────────────────
// Campaign row + per-persona metadata + counts (approved/total + per-status).
// Deliberately loads NO variant bodies — the grid renders body previews from
// the paginated light list, not from the header.

const BODY_PREVIEW_LEN = 120;

export type CampaignHeaderPersona = {
  persona_id: string;
  name: string;
  avatar_color: string;
  slug: string;
  approval_status: string;
};

export type CampaignHeader = {
  campaign: CampaignRow;
  personas: CampaignHeaderPersona[];
  counts: {
    total: number;
    approved: number;
    byStatus: Record<string, number>;
  };
};

export async function getCampaignHeader(
  id: string
): Promise<CampaignHeader | null> {
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campaign) return null;

  // Persona metadata (no variant bodies). personas is a to-one join but
  // PostgREST may wrap it in an array — unwrap defensively.
  const { data: personaRows } = await supabase
    .from("campaign_personas")
    .select("persona_id, approval_status, personas ( id, name, avatar_color, slug )")
    .eq("campaign_id", id);

  type RawPersonaRow = {
    persona_id: string;
    approval_status: string;
    personas?:
      | { name?: string | null; avatar_color?: string | null; slug?: string | null }
      | Array<{ name?: string | null; avatar_color?: string | null; slug?: string | null }>
      | null;
  };
  const personas: CampaignHeaderPersona[] = (
    (personaRows ?? []) as RawPersonaRow[]
  ).map((row) => {
    const p = Array.isArray(row.personas) ? row.personas[0] : row.personas;
    return {
      persona_id: row.persona_id,
      name: p?.name ?? "",
      avatar_color: p?.avatar_color ?? "#64748b",
      slug: p?.slug ?? "",
      approval_status: row.approval_status,
    };
  });

  // Per-status counts across every variant in the campaign. Selects only the
  // status string (never the body) so this stays light even at 50 accounts.
  const { data: statusRows } = await supabase
    .from("campaign_persona_variants")
    .select("campaign_personas!inner ( campaign_id ), post_variants!inner ( status )")
    .eq("campaign_personas.campaign_id", id);

  type RawStatusRow = {
    post_variants?: { status?: string | null } | Array<{ status?: string | null }> | null;
  };
  const byStatus: Record<string, number> = {};
  let approved = 0;
  let total = 0;
  for (const row of (statusRows ?? []) as RawStatusRow[]) {
    const pv = Array.isArray(row.post_variants)
      ? row.post_variants[0]
      : row.post_variants;
    const status = pv?.status ?? "draft";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    total += 1;
    if (isApprovedStatus(status)) approved += 1;
  }

  return { campaign, personas, counts: { total, approved, byStatus } };
}

// ── Light paginated list ──────────────────────────────────────────────────────
// One light row per account+variant. Returns a truncated body_preview, never
// the full body. Filtering + pagination happen at the DB so the grid scales to
// 50 accounts × N platforms.

export type ListVariantsOptions = {
  page?: number;
  pageSize?: number;
  filters?: { status?: string; platform?: string; persona_id?: string };
  sort?: { key: "persona" | "status" | "platform"; dir: "asc" | "desc" };
};

export type ListVariantsResult = {
  rows: GridVariantRow[];
  page: number;
  pageSize: number;
  total: number;
};

const DEFAULT_PAGE_SIZE = 25;

export async function listCampaignVariants(
  id: string,
  opts: ListVariantsOptions = {}
): Promise<ListVariantsResult> {
  const supabase = await createClient();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("campaign_persona_variants")
    .select(
      `
        post_variant_id,
        platform,
        created_at,
        campaign_personas!inner ( campaign_id, persona_id, personas ( name, avatar_color ) ),
        post_variants!inner ( status, body )
      `,
      { count: "exact" }
    )
    .eq("campaign_personas.campaign_id", id);

  if (opts.filters?.persona_id) {
    query = query.eq("campaign_personas.persona_id", opts.filters.persona_id);
  }
  if (opts.filters?.platform) {
    query = query.eq("platform", opts.filters.platform);
  }
  if (opts.filters?.status) {
    query = query.eq("post_variants.status", opts.filters.status);
  }

  // DB-side ordering keeps pagination stable. status/platform sort on their
  // own column; "persona" falls back to insertion order (created_at), which
  // keeps a persona's variants adjacent since they're generated together.
  const ascending = (opts.sort?.dir ?? "asc") === "asc";
  if (opts.sort?.key === "status") {
    query = query.order("status", { referencedTable: "post_variants", ascending });
  } else if (opts.sort?.key === "platform") {
    query = query.order("platform", { ascending });
  } else {
    query = query.order("created_at", { ascending });
  }
  // Deterministic tiebreak so equal keys never straddle a page boundary.
  query = query.order("post_variant_id", { ascending: true });

  const { data, count } = await query.range(from, to);

  type RawRow = {
    post_variant_id: string;
    platform: string;
    campaign_personas?:
      | {
          persona_id?: string | null;
          personas?:
            | { name?: string | null; avatar_color?: string | null }
            | Array<{ name?: string | null; avatar_color?: string | null }>
            | null;
        }
      | Array<{
          persona_id?: string | null;
          personas?:
            | { name?: string | null; avatar_color?: string | null }
            | Array<{ name?: string | null; avatar_color?: string | null }>
            | null;
        }>
      | null;
    post_variants?:
      | { status?: string | null; body?: string | null }
      | Array<{ status?: string | null; body?: string | null }>
      | null;
  };

  const rows: GridVariantRow[] = ((data ?? []) as RawRow[]).map((row) => {
    const cp = Array.isArray(row.campaign_personas)
      ? row.campaign_personas[0]
      : row.campaign_personas;
    const persona = Array.isArray(cp?.personas) ? cp?.personas[0] : cp?.personas;
    const pv = Array.isArray(row.post_variants)
      ? row.post_variants[0]
      : row.post_variants;
    const body = pv?.body ?? "";
    return {
      persona_id: cp?.persona_id ?? "",
      persona_name: persona?.name ?? "",
      avatar_color: persona?.avatar_color ?? "#64748b",
      platform: row.platform,
      post_variant_id: row.post_variant_id,
      status: pv?.status ?? "draft",
      body_preview:
        body.length > BODY_PREVIEW_LEN
          ? body.slice(0, BODY_PREVIEW_LEN) + "…"
          : body,
    };
  });

  return { rows, page, pageSize, total: count ?? 0 };
}

// ── On-demand detail ──────────────────────────────────────────────────────────
// Full body + revisions + media + source for a single variant. Loaded only when
// a row is opened in the drawer (spot-editing), so the grid never pays for it.

export type VariantDetail = {
  id: string;
  platform: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  revisions: PostVariantRevisionRow[];
  media: Array<{ id: string; cloudinary_url: string; resource_type: string }>;
  source: VariantSource | null;
};

export async function getVariantDetail(
  postVariantId: string
): Promise<VariantDetail | null> {
  const supabase = await createClient();
  const { data: variant, error } = await supabase
    .from("post_variants")
    .select(
      "id, platform, body, status, scheduled_at, created_at, content_item_id"
    )
    .eq("id", postVariantId)
    .single();
  if (error || !variant) return null;

  const [revisions, media, source] = await Promise.all([
    listRevisionsForVariant(postVariantId),
    getVariantMedia(postVariantId),
    getVariantSource(variant.content_item_id),
  ]);

  return {
    id: variant.id,
    platform: variant.platform,
    body: variant.body,
    status: variant.status,
    scheduled_at: variant.scheduled_at,
    created_at: variant.created_at,
    revisions,
    media: media.map((m: MediaSelection) => ({
      id: m.media_asset_id,
      cloudinary_url: m.cloudinary_url,
      resource_type: m.resource_type,
    })),
    source,
  };
}
