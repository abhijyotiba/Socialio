// Workspace-scoped connection helpers retained for backward compatibility
// while Phase V2.2 migrates callers to the persona-scoped equivalents. Do not
// add new callers — they will be flagged by ESLint. See:
// docs/phases/PHASE_V2_2_MULTIPERSONA_REDESIGN.md

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type SocialConnectionRow =
  Database['public']['Tables']['social_connections']['Row']

/** @deprecated Use getSocialConnectionForPersona(personaId, platform) instead. */
export async function getSocialConnection(
  workspaceId: string,
  platform: 'linkedin' | 'x'
): Promise<SocialConnectionRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .single()
  if (error) return null
  return data
}

/** @deprecated List connections per persona via getConnectionsForPersona, or aggregate at the route layer. */
export async function getActiveSocialConnections(
  workspaceId: string
): Promise<SocialConnectionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('needs_reauth', false)
  if (error) return []
  return data ?? []
}
