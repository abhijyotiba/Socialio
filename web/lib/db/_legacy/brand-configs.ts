// Workspace-scoped brand helpers retained for backward compatibility while
// Phase V2.2 migrates callers to the persona-scoped equivalents. Do not add
// new callers — they will be flagged by ESLint. See:
// docs/phases/PHASE_V2_2_MULTIPERSONA_REDESIGN.md

import { createClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/db/types'

type BrandConfigRow = Database['public']['Tables']['brand_configs']['Row']

/** @deprecated Use getBrandConfigForPersona(personaId) instead. */
export async function getBrandConfig(
  workspaceId: string
): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs')
    .select('*, personas!inner(workspace_id, is_default)')
    .eq('personas.workspace_id', workspaceId)
    .eq('personas.is_default', true)
    .single()
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- strip join columns before returning
  const { personas: _p, ...row } = data as any
  return row as BrandConfigRow
}

/** @deprecated Use setVoiceProfileForPersona(personaId, profile) instead. */
export async function setVoiceProfile(
  workspaceId: string,
  profile: Json
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('brand_configs')
    .update({
      voice_profile: profile,
      voice_profile_updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
  if (error) throw error
}

/** @deprecated Use getVoiceProfileForPersona(personaId) instead. */
export async function getVoiceProfile(
  workspaceId: string
): Promise<{ profile: Json | null; updated_at: string | null }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs')
    .select('voice_profile, voice_profile_updated_at')
    .eq('workspace_id', workspaceId)
    .single()
  return {
    profile: data?.voice_profile ?? null,
    updated_at: data?.voice_profile_updated_at ?? null,
  }
}
