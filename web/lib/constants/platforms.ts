export const SUPPORTED_PLATFORMS = ['linkedin', 'x'] as const
export type Platform = typeof SUPPORTED_PLATFORMS[number]

export const PERSONA_SOFT_CAP = 10
export const PERSONA_HARD_CAP = 50

// IMPORTANT [B4]: Values duplicated in claim_due_variants SQL RPC.
// When changing these, also update the CASE statement in that RPC (migration 0014).
export const PLATFORM_DAILY_LIMITS: Record<Platform, number> = {
  linkedin: 20,
  x: 50,
}

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  linkedin: 3000,
  x: 280,
}
