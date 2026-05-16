import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'
import { assertPersonaInWorkspace } from '@/lib/auth/persona-guard'
import { SUPPORTED_PLATFORMS, type Platform } from '@/lib/constants/platforms'

export type GenerationContextErrorCode =
  | 'NO_BRAND'
  | 'NO_CONNECTED_PLATFORMS'

export class GenerationContextError extends Error {
  readonly code: GenerationContextErrorCode
  readonly personaId: string
  constructor(code: GenerationContextErrorCode, personaId: string, message: string) {
    super(message)
    this.name = 'GenerationContextError'
    this.code = code
    this.personaId = personaId
  }
}

export type GenerationContext = {
  workspace_id: string
  persona_id: string
  persona_name: string
  brand_system_prompt: string
  // Snapshot of the prompt version used. Stored on every variant the worker
  // generates so brand voice updates between generation and approval don't
  // silently desync the audit trail.
  prompt_version_id: string | null
  platforms: Platform[]
}

export async function buildGenerationContext(args: {
  personaId: string
  workspaceId: string
  requestedPlatforms?: readonly Platform[]
}): Promise<GenerationContext> {
  const persona = await assertPersonaInWorkspace(args.personaId, args.workspaceId)

  const [brand, connections] = await Promise.all([
    getBrandConfigForPersona(args.personaId),
    getConnectionsForPersona(args.personaId),
  ])

  if (!brand?.custom_system_prompt) {
    throw new GenerationContextError(
      'NO_BRAND',
      args.personaId,
      `Persona "${persona.name}" has no voice profile set`
    )
  }

  const connectedPlatforms = connections
    .filter((c) => !c.needs_reauth)
    .map((c) => c.platform)
    .filter((p): p is Platform =>
      (SUPPORTED_PLATFORMS as readonly string[]).includes(p)
    )

  const platforms = args.requestedPlatforms
    ? args.requestedPlatforms.filter((p) => connectedPlatforms.includes(p))
    : connectedPlatforms

  if (platforms.length === 0) {
    throw new GenerationContextError(
      'NO_CONNECTED_PLATFORMS',
      args.personaId,
      `Persona "${persona.name}" has no connected platforms for the requested targets`
    )
  }

  return {
    workspace_id: args.workspaceId,
    persona_id: args.personaId,
    persona_name: persona.name,
    brand_system_prompt: brand.custom_system_prompt,
    prompt_version_id: brand.current_prompt_version_id,
    platforms: [...platforms],
  }
}
