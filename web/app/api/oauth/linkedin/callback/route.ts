import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { workerLinkedinCallback } from '@/lib/worker-client'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona } from '@/lib/db/personas'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = session.user

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('linkedin_oauth_state')?.value
  if (!savedState || savedState !== state) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const colonIdx = savedState.indexOf(':')
  if (colonIdx === -1) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }
  const personaId = savedState.slice(colonIdx + 1)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!personaId || !UUID_RE.test(personaId)) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  }

  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona mismatch' }, { status: 403 })
  }

  try {
    const res = await workerLinkedinCallback(code, personaId, session.access_token)
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'LinkedIn token exchange failed' }))
      return NextResponse.json({ error: data.error || 'LinkedIn token exchange failed' }, { status: res.status })
    }
  } catch {
    return NextResponse.json({ error: 'LinkedIn token exchange failed' }, { status: 502 })
  }

  cookieStore.delete('linkedin_oauth_state')

  return NextResponse.redirect(
    new URL(`/settings/personas/${personaId}/connections?linkedin=connected`, request.url)
  )
}
