import {
  PLATFORM_DAILY_LIMITS,
  PERSONA_SOFT_CAP,
  type Platform,
} from '@/lib/constants/platforms'
import { countRecentCampaigns } from '@/lib/db/campaigns'
import { checkAndIncrementRateLimit } from '@/lib/db/persona-rate-limits'

export const MAX_PERSONAS_PER_CAMPAIGN = PERSONA_SOFT_CAP
export const CAMPAIGNS_PER_MINUTE = 2

export { PLATFORM_DAILY_LIMITS } from '@/lib/constants/platforms'

export type PolicyDecision =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number }

export async function canGenerateCampaign(
  workspaceId: string,
  fanOut: number
): Promise<PolicyDecision> {
  if (fanOut < 1) {
    return {
      ok: false,
      code: 'EMPTY_FAN_OUT',
      message: 'Campaign must target at least one persona',
      status: 400,
    }
  }
  if (fanOut > MAX_PERSONAS_PER_CAMPAIGN) {
    return {
      ok: false,
      code: 'FAN_OUT_EXCEEDED',
      message: `A single campaign may target at most ${MAX_PERSONAS_PER_CAMPAIGN} personas`,
      status: 400,
    }
  }
  const recent = await countRecentCampaigns(workspaceId, 60)
  if (recent >= CAMPAIGNS_PER_MINUTE) {
    return {
      ok: false,
      code: 'WORKSPACE_RATE_LIMIT',
      message: `Rate limit: ${CAMPAIGNS_PER_MINUTE} campaigns per minute`,
      status: 429,
    }
  }
  return { ok: true }
}

// Atomically reserves one unit of the persona's daily publish budget.
// Cron workers should NOT use this — they go through the claim_due_variants
// RPC which enforces the same limits in SQL under FOR UPDATE SKIP LOCKED.
export async function consumePublishBudget(
  personaId: string,
  platform: Platform
): Promise<PolicyDecision> {
  const granted = await checkAndIncrementRateLimit(personaId, platform)
  if (!granted) {
    return {
      ok: false,
      code: 'PERSONA_DAILY_LIMIT',
      message: `Persona has hit today's ${platform} limit (${PLATFORM_DAILY_LIMITS[platform]})`,
      status: 429,
    }
  }
  return { ok: true }
}
