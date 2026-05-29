import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type CadenceRow = Database['public']['Tables']['content_cadences']['Row']
type ContentItemRow = Database['public']['Tables']['content_items']['Row']
type PostVariantRow = Database['public']['Tables']['post_variants']['Row']

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

// Post variants awaiting batch approval (autopilot OFF path). Joined to the
// content_item so the review UI can show the matrix metadata (format/angle)
// that explains why each post is distinct.
export type PendingApprovalVariant = PostVariantRow & {
  content_items?: {
    format: ContentItemRow['format']
    angle: ContentItemRow['angle']
  } | null
}

export async function listPendingApprovalVariants(
  workspaceId: string
): Promise<PendingApprovalVariant[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('post_variants')
    .select('*, content_items ( format, angle )')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as PendingApprovalVariant[]
}
