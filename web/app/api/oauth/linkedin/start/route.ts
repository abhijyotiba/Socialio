import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizationUrl } from '@/lib/adapters/linkedin'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getDefaultPersona, getPersona } from '@/lib/db/personas'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  }

  // Resolve persona_id: use query param if provided, else fall back to default
  let personaId = new URL(request.url).searchParams.get('persona_id')
  if (!personaId) {
    const defaultPersona = await getDefaultPersona(workspace.workspace_id)
    if (!defaultPersona) {
      return NextResponse.json({ error: 'No default persona' }, { status: 400 })
    }
    personaId = defaultPersona.id
  }

  // [A10] Validate the persona actually belongs to this workspace
  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
  }

  // [A1] State format: "<32-char hex>:<persona-uuid>"
  const state = `${randomBytes(16).toString('hex')}:${personaId}`

  const cookieStore = await cookies()
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return NextResponse.redirect(buildAuthorizationUrl(state))
}
