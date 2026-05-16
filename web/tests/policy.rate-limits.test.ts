import { describe, it, expect, vi, beforeEach } from 'vitest'

const countRecentCampaignsMock = vi.fn()
const checkAndIncrementRateLimitMock = vi.fn()

vi.mock('@/lib/db/campaigns', () => ({
  countRecentCampaigns: (...args: unknown[]) => countRecentCampaignsMock(...args),
}))
vi.mock('@/lib/db/persona-rate-limits', () => ({
  checkAndIncrementRateLimit: (...args: unknown[]) =>
    checkAndIncrementRateLimitMock(...args),
}))

describe('canGenerateCampaign', () => {
  beforeEach(() => {
    countRecentCampaignsMock.mockReset()
  })

  it('rejects fan-out of zero', async () => {
    const { canGenerateCampaign } = await import('@/lib/policy/rate-limits')
    const r = await canGenerateCampaign('w1', 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('EMPTY_FAN_OUT')
  })

  it('rejects fan-out beyond the soft cap', async () => {
    const { canGenerateCampaign, MAX_PERSONAS_PER_CAMPAIGN } = await import(
      '@/lib/policy/rate-limits'
    )
    const r = await canGenerateCampaign('w1', MAX_PERSONAS_PER_CAMPAIGN + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('FAN_OUT_EXCEEDED')
  })

  it('rejects when workspace already created CAMPAIGNS_PER_MINUTE this minute', async () => {
    const { canGenerateCampaign, CAMPAIGNS_PER_MINUTE } = await import(
      '@/lib/policy/rate-limits'
    )
    countRecentCampaignsMock.mockResolvedValueOnce(CAMPAIGNS_PER_MINUTE)
    const r = await canGenerateCampaign('w1', 1)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('WORKSPACE_RATE_LIMIT')
      expect(r.status).toBe(429)
    }
  })

  it('allows when fan-out and rate are both within bounds', async () => {
    const { canGenerateCampaign } = await import('@/lib/policy/rate-limits')
    countRecentCampaignsMock.mockResolvedValueOnce(0)
    const r = await canGenerateCampaign('w1', 3)
    expect(r.ok).toBe(true)
  })
})

describe('consumePublishBudget', () => {
  beforeEach(() => {
    checkAndIncrementRateLimitMock.mockReset()
  })

  it('returns ok when budget granted', async () => {
    const { consumePublishBudget } = await import('@/lib/policy/rate-limits')
    checkAndIncrementRateLimitMock.mockResolvedValueOnce(true)
    const r = await consumePublishBudget('p1', 'linkedin')
    expect(r.ok).toBe(true)
  })

  it('returns PERSONA_DAILY_LIMIT when budget exhausted', async () => {
    const { consumePublishBudget } = await import('@/lib/policy/rate-limits')
    checkAndIncrementRateLimitMock.mockResolvedValueOnce(false)
    const r = await consumePublishBudget('p1', 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('PERSONA_DAILY_LIMIT')
      expect(r.status).toBe(429)
    }
  })
})
