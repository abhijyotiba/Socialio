import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getDefaultPersona } from '@/lib/db/personas'
import { workerFetch } from '@/lib/worker-client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await getWorkspaceForUser(session.user.id)
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

  const res = await workerFetch(`/oauth/linkedin/auth-url?persona_id=${personaId}`, {
    method: 'GET',
    accessToken: session.access_token
  })

  if (!res.ok) {
     return NextResponse.json({ error: 'Failed to generate auth url' }, { status: 502 })
  }

  const { auth_url, state } = await res.json()

  const cookieStore = await cookies()
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return NextResponse.redirect(auth_url)
}
