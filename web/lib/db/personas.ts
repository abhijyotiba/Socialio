import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'
import { PERSONA_HARD_CAP } from '@/lib/constants/platforms'

type PersonaRow = Database['public']['Tables']['personas']['Row']

export async function generatePersonaSlug(workspaceId: string, name: string): Promise<string> {
  const supabase = await createClient()
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'persona'
  for (let i = 0; i <= 10; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const { data } = await supabase
      .from('personas').select('id').eq('workspace_id', workspaceId).eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now()}`
}

export async function getPersonasForWorkspace(workspaceId: string): Promise<PersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('personas').select('*').eq('workspace_id', workspaceId)
    .order('is_default', { ascending: false }).order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getPersona(id: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('personas').select('*').eq('id', id).single()
  return data
}

export async function getDefaultPersona(workspaceId: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('personas').select('*').eq('workspace_id', workspaceId).eq('is_default', true).single()
  return data
}

export async function createPersona(
  workspaceId: string, name: string, avatarColor?: string
): Promise<PersonaRow> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('personas').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  if ((count ?? 0) >= PERSONA_HARD_CAP) {
    throw new Error(`Workspace has reached the maximum of ${PERSONA_HARD_CAP} personas`)
  }
  const slug = await generatePersonaSlug(workspaceId, name)
  const { data, error } = await supabase
    .from('personas')
    .insert({ workspace_id: workspaceId, name, slug, avatar_color: avatarColor ?? '#6366f1' })
    .select().single()
  if (error) throw error
  return data
}

export async function updatePersona(
  id: string, patch: Pick<Partial<PersonaRow>, 'name' | 'avatar_color'>
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('personas').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePersona(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: persona } = await supabase
    .from('personas').select('is_default').eq('id', id).single()
  if (persona?.is_default) throw new Error('Cannot delete the default persona')

  const { count: activeCampaignCount } = await supabase
    .from('campaign_personas').select('id', { count: 'exact', head: true })
    .eq('persona_id', id).eq('approval_status', 'pending')
  if ((activeCampaignCount ?? 0) > 0) {
    throw new Error('Cannot delete a persona with pending campaigns. Reject or complete them first.')
  }

  const { error } = await supabase.from('personas').delete().eq('id', id)
  if (error) throw error
}
