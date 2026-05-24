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

export async function updateCampaign(id: string, patch: Partial<CampaignRow>): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('campaigns').update(patch).eq('id', id)
  if (error) throw error
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

// A variant is "live" if it's headed for, or has already touched, a real
// social network. Deleting the campaign cascades to post_variants, which
// would erase the audit trail of a real post — we never want that.
//
// 'draft'/'failed'/'cancelled' are safe to delete: draft never went out,
// the other two were terminal failures with no real-world side effect.
const LIVE_VARIANT_STATUSES = ['scheduled', 'publishing', 'published'] as const

export async function hasLiveVariants(campaignId: string): Promise<boolean> {
  const supabase = await createClient()

  const { data: cps, error: cpErr } = await supabase
    .from('campaign_personas')
    .select('id')
    .eq('campaign_id', campaignId)
  if (cpErr) throw cpErr
  const cpIds = (cps ?? []).map(r => r.id)
  if (cpIds.length === 0) return false

  const { data: cpvs, error: cpvErr } = await supabase
    .from('campaign_persona_variants')
    .select('post_variant_id')
    .in('campaign_persona_id', cpIds)
  if (cpvErr) throw cpvErr
  const variantIds = (cpvs ?? []).map(r => r.post_variant_id)
  if (variantIds.length === 0) return false

  const { count, error: pvErr } = await supabase
    .from('post_variants')
    .select('id', { count: 'exact', head: true })
    .in('id', variantIds)
    .in('status', LIVE_VARIANT_STATUSES as unknown as string[])
  if (pvErr) throw pvErr
  return (count ?? 0) > 0
}

export async function deleteCampaign(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('campaigns').delete().eq('id', id)
  if (error) throw error
}

// Flip every scheduled variant on this campaign to 'cancelled' so the cron
// stops trying to publish them. Idempotent — cancelling twice is a no-op.
// Variants already 'publishing' / 'published' / 'failed' are untouched.
export async function cancelScheduledVariantsForCampaign(
  campaignId: string
): Promise<number> {
  const supabase = await createClient()

  const { data: cps, error: cpErr } = await supabase
    .from('campaign_personas')
    .select('id')
    .eq('campaign_id', campaignId)
  if (cpErr) throw cpErr
  const cpIds = (cps ?? []).map(r => r.id)
  if (cpIds.length === 0) return 0

  const { data: cpvs, error: cpvErr } = await supabase
    .from('campaign_persona_variants')
    .select('post_variant_id')
    .in('campaign_persona_id', cpIds)
  if (cpvErr) throw cpvErr
  const variantIds = (cpvs ?? []).map(r => r.post_variant_id)
  if (variantIds.length === 0) return 0

  const { data, error } = await supabase
    .from('post_variants')
    .update({ status: 'cancelled' })
    .in('id', variantIds)
    .eq('status', 'scheduled')
    .select('id')
  if (error) throw error
  return (data ?? []).length
}

export async function updateCampaignPersonaApproval(
  campaignPersonaId: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaign_personas')
    .update({
      approval_status: status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', campaignPersonaId)
  if (error) throw error
}

export async function getVariantsForCampaignPersona(
  campaignPersonaId: string
): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaign_persona_variants')
    .select('post_variant_id')
    .eq('campaign_persona_id', campaignPersonaId)
  return (data ?? []).map(row => row.post_variant_id)
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
