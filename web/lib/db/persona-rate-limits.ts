import { createClient } from '@/lib/supabase/server'
import { PLATFORM_DAILY_LIMITS, type Platform } from '@/lib/constants/platforms'

export async function checkAndIncrementRateLimit(
  personaId: string,
  platform: Platform
): Promise<boolean> {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]  // YYYY-MM-DD UTC
  const dailyLimit = PLATFORM_DAILY_LIMITS[platform]

  const { data: existing } = await supabase
    .from('persona_rate_limits')
    .select('*')
    .eq('persona_id', personaId)
    .eq('platform', platform)
    .maybeSingle()

  if (!existing) {
    await supabase.from('persona_rate_limits').insert({
      persona_id: personaId,
      platform,
      posts_today: 1,
      last_post_at: new Date().toISOString(),
      day_reset_at: today,
    })
    return true
  }

  // Reset counter if we've crossed into a new UTC day
  const count = existing.day_reset_at < today ? 0 : existing.posts_today
  if (count >= dailyLimit) return false

  await supabase
    .from('persona_rate_limits')
    .update({
      posts_today: count + 1,
      last_post_at: new Date().toISOString(),
      day_reset_at: today,
    })
    .eq('persona_id', personaId)
    .eq('platform', platform)

  return true
}
