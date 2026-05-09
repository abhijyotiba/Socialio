import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase client
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))

describe('deletePersona', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if persona is default', async () => {
    const { deletePersona } = await import('@/lib/db/personas')

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { is_default: true }, error: null }),
        }),
      }),
    })

    await expect(deletePersona('some-id')).rejects.toThrow('Cannot delete the default persona')
  })

  it('throws if persona has pending campaigns', async () => {
    const { deletePersona } = await import('@/lib/db/personas')

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { is_default: false }, error: null }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }
    })

    await expect(deletePersona('some-id')).rejects.toThrow('pending campaigns')
  })
})
