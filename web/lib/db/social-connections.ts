import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type SocialConnectionRow =
  Database['public']['Tables']['social_connections']['Row']
type SocialConnectionInsert =
  Database['public']['Tables']['social_connections']['Insert']

export async function upsertSocialConnection(
  values: SocialConnectionInsert,
  // Accepts a pre-created client so the OAuth callback can pass its admin client.
  // Defaults to user-scoped client for all other callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic Supabase client
  clientOverride?: any
): Promise<SocialConnectionRow> {
  const supabase = clientOverride ?? (await createClient())
  const { data, error } = await supabase
    .from('social_connections')
    .upsert(values, { onConflict: 'persona_id,platform' })
    .select()
    .single()
  if (error) throw error
  return data
}

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

// Re-exports of workspace-scoped helpers retained for backward compatibility.
// New callers are flagged by ESLint. The implementations live in
// _legacy/social-connections.ts and will be deleted once all callers migrate.
export {
  getSocialConnection,
  getActiveSocialConnections,
} from '@/lib/db/_legacy/social-connections'
