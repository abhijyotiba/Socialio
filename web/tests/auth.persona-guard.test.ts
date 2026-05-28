import { describe, it, expect, vi, beforeEach } from 'vitest'

const getPersonaMock = vi.fn()
vi.mock('@/lib/db/personas', () => ({
  getPersona: (id: string) => getPersonaMock(id),
}))

describe('assertPersonaInWorkspace', () => {
  beforeEach(() => {
    getPersonaMock.mockReset()
  })

  it('returns the persona on success', async () => {
    const { assertPersonaInWorkspace } = await import('@/lib/auth/persona-guard')
    const persona = { id: 'p1', workspace_id: 'w1', name: 'Default' }
    getPersonaMock.mockResolvedValueOnce(persona)
    await expect(assertPersonaInWorkspace('p1', 'w1')).resolves.toBe(persona)
  })

  it('throws NOT_FOUND when persona missing', async () => {
    const { assertPersonaInWorkspace, PersonaGuardError } = await import(
      '@/lib/auth/persona-guard'
    )
    getPersonaMock.mockResolvedValueOnce(null)
    try {
      await assertPersonaInWorkspace('p1', 'w1')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PersonaGuardError)
      expect((err as InstanceType<typeof PersonaGuardError>).code).toBe(
        'NOT_FOUND'
      )
    }
  })

  it('throws WORKSPACE_MISMATCH when persona belongs to another workspace', async () => {
    const { assertPersonaInWorkspace, PersonaGuardError } = await import(
      '@/lib/auth/persona-guard'
    )
    getPersonaMock.mockResolvedValueOnce({
      id: 'p1',
      workspace_id: 'w-other',
      name: 'X',
    })
    try {
      await assertPersonaInWorkspace('p1', 'w1')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PersonaGuardError)
      expect((err as InstanceType<typeof PersonaGuardError>).code).toBe(
        'WORKSPACE_MISMATCH'
      )
    }
  })
})

