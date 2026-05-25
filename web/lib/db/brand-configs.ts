import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type BrandConfigRow = Database['public']['Tables']['brand_configs']['Row']

// Writes (upsert, set voice profile) and prompt-version minting now live in the
// Python worker (worker/routes/brand.py). This read stays for the GET routes.
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
