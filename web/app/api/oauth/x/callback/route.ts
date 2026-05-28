import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { workerXCallback } from '@/lib/worker-client'
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
  const xError = searchParams.get('error')
  if (xError) {
    const desc = searchParams.get('error_description') ?? xError
    return NextResponse.redirect(
      new URL(`/settings/connections?x_error=${encodeURIComponent(desc)}`, request.url)
    )
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/settings/connections?x_error=missing_code', request.url)
    )
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('x_oauth_state')?.value
  const codeVerifier = cookieStore.get('x_code_verifier')?.value

  if (!savedState || savedState !== state || !codeVerifier) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const colonIdx = savedState.indexOf(':')
  if (colonIdx === -1) {
    return NextResponse.redirect(
      new URL('/settings/connections?x_error=invalid_state', request.url)
    )
  }
  const personaId = savedState.slice(colonIdx + 1)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!personaId || !UUID_RE.test(personaId)) {
    return NextResponse.redirect(
      new URL('/settings/connections?x_error=invalid_state', request.url)
    )
  }

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  }

  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.redirect(
      new URL('/settings/connections?x_error=persona_mismatch', request.url)
    )
  }

  try {
    const res = await workerXCallback(code, personaId, codeVerifier, session.access_token)
    if (!res.ok) {
      return NextResponse.json({ error: 'X token exchange failed' }, { status: res.status })
    }
  } catch {
    return NextResponse.json({ error: 'X token exchange failed' }, { status: 502 })
  }

  cookieStore.delete('x_oauth_state')
  cookieStore.delete('x_code_verifier')

  return NextResponse.redirect(
    new URL(`/settings/personas/${personaId}/connections?x=connected`, request.url)
  )
}
