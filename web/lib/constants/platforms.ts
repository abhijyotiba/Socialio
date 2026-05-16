export const SUPPORTED_PLATFORMS = ['linkedin', 'x'] as const
export type Platform = typeof SUPPORTED_PLATFORMS[number]

export const PERSONA_SOFT_CAP = 10
export const PERSONA_HARD_CAP = 50

// Source of truth: the public.platform_limits table (migration 0016).
// The claim_due_variants RPC JOINs that table, so changing limits in SQL
// flows through automatically. These TS constants are validated against the
// migration seed by tests/constants.platform-limits.test.ts — keep them in
// sync when you change either side.
export const PLATFORM_DAILY_LIMITS: Record<Platform, number> = {
  linkedin: 20,
  x: 50,
}

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  linkedin: 3000,
  x: 280,
}
