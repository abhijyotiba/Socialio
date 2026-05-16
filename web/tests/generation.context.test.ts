import { describe, it, expect, vi, beforeEach } from 'vitest'

const assertPersonaInWorkspaceMock = vi.fn()
const getBrandConfigForPersonaMock = vi.fn()
const getConnectionsForPersonaMock = vi.fn()

vi.mock('@/lib/auth/persona-guard', () => ({
  assertPersonaInWorkspace: (...args: unknown[]) =>
    assertPersonaInWorkspaceMock(...args),
}))
vi.mock('@/lib/db/brand-configs', () => ({
  getBrandConfigForPersona: (...args: unknown[]) =>
    getBrandConfigForPersonaMock(...args),
}))
vi.mock('@/lib/db/social-connections', () => ({
  getConnectionsForPersona: (...args: unknown[]) =>
    getConnectionsForPersonaMock(...args),
}))

const persona = { id: 'p1', workspace_id: 'w1', name: 'Default' }
const brand = {
  persona_id: 'p1',
  custom_system_prompt: 'You write like a robot.',
  current_prompt_version_id: 'pv-1',
}

describe('buildGenerationContext', () => {
  beforeEach(() => {
    assertPersonaInWorkspaceMock.mockReset()
    getBrandConfigForPersonaMock.mockReset()
    getConnectionsForPersonaMock.mockReset()
  })

  it('returns a context with intersection of requested + connected platforms', async () => {
    const { buildGenerationContext } = await import('@/lib/generation/context')
    assertPersonaInWorkspaceMock.mockResolvedValueOnce(persona)
    getBrandConfigForPersonaMock.mockResolvedValueOnce(brand)
    getConnectionsForPersonaMock.mockResolvedValueOnce([
      { platform: 'linkedin', needs_reauth: false },
      { platform: 'x', needs_reauth: false },
    ])
    const ctx = await buildGenerationContext({
      personaId: 'p1',
      workspaceId: 'w1',
      requestedPlatforms: ['linkedin'],
    })
    expect(ctx.platforms).toEqual(['linkedin'])
    expect(ctx.persona_name).toBe('Default')
    expect(ctx.prompt_version_id).toBe('pv-1')
  })

  it('uses all connected platforms when none requested', async () => {
    const { buildGenerationContext } = await import('@/lib/generation/context')
    assertPersonaInWorkspaceMock.mockResolvedValueOnce(persona)
    getBrandConfigForPersonaMock.mockResolvedValueOnce(brand)
    getConnectionsForPersonaMock.mockResolvedValueOnce([
      { platform: 'linkedin', needs_reauth: false },
      { platform: 'x', needs_reauth: false },
    ])
    const ctx = await buildGenerationContext({
      personaId: 'p1',
      workspaceId: 'w1',
    })
    expect(new Set(ctx.platforms)).toEqual(new Set(['linkedin', 'x']))
  })

  it('skips connections flagged needs_reauth', async () => {
    const { buildGenerationContext } = await import('@/lib/generation/context')
    assertPersonaInWorkspaceMock.mockResolvedValueOnce(persona)
    getBrandConfigForPersonaMock.mockResolvedValueOnce(brand)
    getConnectionsForPersonaMock.mockResolvedValueOnce([
      { platform: 'linkedin', needs_reauth: true },
      { platform: 'x', needs_reauth: false },
    ])
    const ctx = await buildGenerationContext({
      personaId: 'p1',
      workspaceId: 'w1',
    })
    expect(ctx.platforms).toEqual(['x'])
  })

  it('throws NO_BRAND when persona has no system prompt', async () => {
    const { buildGenerationContext, GenerationContextError } = await import(
      '@/lib/generation/context'
    )
    assertPersonaInWorkspaceMock.mockResolvedValueOnce(persona)
    getBrandConfigForPersonaMock.mockResolvedValueOnce({
      ...brand,
      custom_system_prompt: null,
    })
    getConnectionsForPersonaMock.mockResolvedValueOnce([])
    try {
      await buildGenerationContext({ personaId: 'p1', workspaceId: 'w1' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationContextError)
      expect((err as InstanceType<typeof GenerationContextError>).code).toBe(
        'NO_BRAND'
      )
    }
  })

  it('throws NO_CONNECTED_PLATFORMS when intersection is empty', async () => {
    const { buildGenerationContext, GenerationContextError } = await import(
      '@/lib/generation/context'
    )
    assertPersonaInWorkspaceMock.mockResolvedValueOnce(persona)
    getBrandConfigForPersonaMock.mockResolvedValueOnce(brand)
    getConnectionsForPersonaMock.mockResolvedValueOnce([
      { platform: 'linkedin', needs_reauth: false },
    ])
    try {
      await buildGenerationContext({
        personaId: 'p1',
        workspaceId: 'w1',
        requestedPlatforms: ['x'],
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationContextError)
      expect((err as InstanceType<typeof GenerationContextError>).code).toBe(
        'NO_CONNECTED_PLATFORMS'
      )
    }
  })
})
