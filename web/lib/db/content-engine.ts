import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CadenceRow = Database['public']['Tables']['content_cadences']['Row']

// Reservoir level = planned matrix cells not yet rendered/scheduled for a
// persona+platform. Computed state, not a stored column.
export async function getReservoirForPersona(
  personaId: string,
  platform: string
): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('persona_id', personaId)
    .eq('platform', platform)
    .eq('status', 'planned')
  if (error) throw error
  return count ?? 0
}

export async function getCadencesForWorkspace(
  workspaceId: string
): Promise<CadenceRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_cadences')
    .select('*')
    .eq('workspace_id', workspaceId)
  if (error) throw error
  return data ?? []
}
