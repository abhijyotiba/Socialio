import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type SocialConnectionRow =
  Database['public']['Tables']['social_connections']['Row']

export async function getSocialConnectionForPersona(
  personaId: string,
  platform: string
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*')
    .eq('persona_id', personaId)
    .eq('platform', platform)
    .maybeSingle()
  return data
}

export async function getConnectionsForPersona(
  personaId: string
): Promise<SocialConnectionRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*')
    .eq('persona_id', personaId)
  return data ?? []
}

// All social connections in a workspace in one query — replaces the N+1
// fan-out of getConnectionsForPersona over every persona. RLS scopes by
// workspace; the explicit eq() keeps the filter visible.
export async function getConnectionsForWorkspace(
  workspaceId: string
): Promise<SocialConnectionRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
  return data ?? []
}
