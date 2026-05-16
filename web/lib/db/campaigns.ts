import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignInsert = Database['public']['Tables']['campaigns']['Insert']
type CampaignPersonaRow = Database['public']['Tables']['campaign_personas']['Row']
type CampaignPersonaVariantRow = Database['public']['Tables']['campaign_persona_variants']['Row']

export type CampaignWithPersonas = CampaignRow & {
  campaign_personas: Array<CampaignPersonaRow & {
    persona: { id: string; name: string; avatar_color: string; slug: string }
    variants: Array<{
      id: string
      platform: string
      post_variant_id: string
      body: string
      status: string
    }>
  }>
}

export async function createCampaign(values: CampaignInsert): Promise<CampaignRow> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('campaigns').insert(values).select().single()
  if (error) throw error
  return data
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
      campaign_personas (
        *,
        persona:personas ( id, name, avatar_color, slug ),
        variants:campaign_persona_variants (
          id,
          platform,
          post_variant_id,
          post_variants ( body, status )
        )
      )
    `)
    .eq('id', id)
    .single()
  return data as CampaignWithPersonas | null
}

export async function createCampaignPersonas(
  campaignId: string,
  personaIds: string[]
): Promise<CampaignPersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaign_personas')
    .insert(personaIds.map(personaId => ({ campaign_id: campaignId, persona_id: personaId })))
    .select()
  if (error) throw error
  return data ?? []
}

export async function createCampaignPersonaVariants(
  campaignPersonaId: string,
  variants: Array<{
    post_variant_id: string
    platform: string
    prompt_version_id?: string | null
  }>
): Promise<CampaignPersonaVariantRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaign_persona_variants')
    .insert(
      variants.map(v => ({
        campaign_persona_id: campaignPersonaId,
        post_variant_id: v.post_variant_id,
        platform: v.platform,
        prompt_version_id: v.prompt_version_id ?? null,
      }))
    )
    .select()
  if (error) throw error
  return data ?? []
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
