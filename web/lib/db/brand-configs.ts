import { createClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/db/types'

type BrandConfigRow = Database['public']['Tables']['brand_configs']['Row']
type BrandConfigInsert =
  Database['public']['Tables']['brand_configs']['Insert']

export async function upsertBrandConfig(
  values: BrandConfigInsert
): Promise<BrandConfigRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('brand_configs')
    .upsert(values, { onConflict: 'persona_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getBrandConfigForPersona(
  personaId: string
): Promise<BrandConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brand_configs')
    .select('*')
    .eq('persona_id', personaId)
    .single()
  return data
}

export async function setVoiceProfileForPersona(
  personaId: string,
  profile: Json
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('brand_configs')
    .update({
      voice_profile: profile,
      voice_profile_updated_at: new Date().toISOString(),
    })
    .eq('persona_id', personaId)
  if (error) throw error
}

// Re-exports of workspace-scoped helpers retained for backward compatibility.
// New callers are flagged by ESLint. The implementations live in
// _legacy/brand-configs.ts and will be deleted once all callers migrate.
export {
  getBrandConfig,
  setVoiceProfile,
  getVoiceProfile,
} from '@/lib/db/_legacy/brand-configs'
