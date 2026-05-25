import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersonasForWorkspace } from '@/lib/db/personas'
import { workerFetch } from '@/lib/worker-client'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const personas = await getPersonasForWorkspace(workspace.workspace_id)
  return NextResponse.json({ personas })
}

// Thin proxy: the worker owns create (soft/hard cap, slug generation) under RLS.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => ({}))

  try {
    const res = await workerFetch('/personas', {
      method: 'POST',
      accessToken: session.access_token,
      json: payload,
    })
    const data = await res.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
