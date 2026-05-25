import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignPersonaRow = Database['public']['Tables']['campaign_personas']['Row']

export type CampaignWithPersonas = CampaignRow & {
  ingestion_job?: {
    source_type: string
    source_url: string | null
    source_text: string | null
    extracted_title: string | null
  } | null
  campaign_personas: Array<CampaignPersonaRow & {
    persona: {
      id: string
      name: string
      avatar_color: string
      slug: string
      // brand_configs is joined to surface the persona's current voice
      // version. Returned as an array by PostgREST even though the FK is
      // unique; CampaignDetail picks element 0.
      brand_configs?: Array<{ current_prompt_version_id: string | null }>
        | { current_prompt_version_id: string | null }
        | null
    }
    variants: Array<{
      id: string
      platform: string
      post_variant_id: string
      body: string
      status: string
      prompt_version_id: string | null
    }>
  }>
}

export async function getCampaignWithPersonas(id: string): Promise<CampaignWithPersonas | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select(`
      *,
      ingestion_job:ingestion_jobs (
        source_type, source_url, source_text, extracted_title
      ),
      campaign_personas (
        *,
        persona:personas (
          id, name, avatar_color, slug,
          brand_configs ( current_prompt_version_id )
        ),
        variants:campaign_persona_variants (
          id,
          platform,
          post_variant_id,
          prompt_version_id,
          post_variants ( body, status )
        )
      )
    `)
    .eq('id', id)
    .single()
  if (!data) return null

  // PostgREST nests the joined post_variants row under `post_variants` (and
  // sometimes wraps it in an array). The CampaignWithPersonas type promises a
  // flattened shape, so unwrap here in one place rather than at every call
  // site. Keeping the raw `post_variants` field around so existing tolerant
  // readers (CampaignDetail uses it as a fallback) continue to work.
  type RawVariant = {
    id: string
    platform: string
    post_variant_id: string
    prompt_version_id: string | null
    post_variants?:
      | { body?: string | null; status?: string | null }
      | Array<{ body?: string | null; status?: string | null }>
      | null
  }
  const raw = data as unknown as {
    campaign_personas?: Array<{
      variants?: RawVariant[]
    }>
  }
  for (const cp of raw.campaign_personas ?? []) {
    for (const v of cp.variants ?? []) {
      const pv = Array.isArray(v.post_variants)
        ? v.post_variants[0]
        : v.post_variants
      ;(v as unknown as { body: string; status: string }).body = pv?.body ?? ''
      ;(v as unknown as { body: string; status: string }).status = pv?.status ?? 'draft'
    }
  }
  return data as unknown as CampaignWithPersonas
}

export async function countRecentCampaigns(
  workspaceId: string,
  windowSeconds: number
): Promise<number> {
  const supabase = await createClient()
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { count } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
  return count ?? 0
}

export type CampaignListRow = CampaignRow & {
  persona_count: number
  pending_count: number
}

export async function listCampaignsForWorkspace(
  workspaceId: string,
  limit = 50
): Promise<CampaignListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, campaign_personas(approval_status)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Array<
    CampaignRow & {
      campaign_personas: Array<{ approval_status: string }>
    }
  >).map(row => {
    const { campaign_personas, ...rest } = row
    const personas = campaign_personas ?? []
    return {
      ...rest,
      persona_count: personas.length,
      pending_count: personas.filter(p => p.approval_status === 'pending').length,
    }
  })
}
