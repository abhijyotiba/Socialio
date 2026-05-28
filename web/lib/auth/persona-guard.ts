import { getPersona } from '@/lib/db/personas'
import type { Database } from '@/lib/db/types'

type PersonaRow = Database['public']['Tables']['personas']['Row']

export type PersonaGuardErrorCode =
  | 'NOT_FOUND'
  | 'WORKSPACE_MISMATCH'

export class PersonaGuardError extends Error {
  readonly code: PersonaGuardErrorCode
  constructor(code: PersonaGuardErrorCode, message: string) {
    super(message)
    this.name = 'PersonaGuardError'
    this.code = code
  }
}

export async function assertPersonaInWorkspace(
  personaId: string,
  workspaceId: string
): Promise<PersonaRow> {
  const persona = await getPersona(personaId)
  if (!persona) {
    throw new PersonaGuardError('NOT_FOUND', 'Persona not found')
  }
  if (persona.workspace_id !== workspaceId) {
    throw new PersonaGuardError(
      'WORKSPACE_MISMATCH',
      'Persona does not belong to this workspace'
    )
  }
  return persona
}

