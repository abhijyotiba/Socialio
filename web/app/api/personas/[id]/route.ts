import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona } from '@/lib/db/personas'
import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'
import { workerFetch } from '@/lib/worker-client'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [brandConfig, connections] = await Promise.all([
    getBrandConfigForPersona(id),
    getConnectionsForPersona(id),
  ])

  return NextResponse.json({
    persona,
    brand_config: brandConfig ? {
      brand_name: brandConfig.brand_name,
      has_voice_profile: !!brandConfig.custom_system_prompt,
    } : null,
    connections: connections.map(c => ({ platform: c.platform, needs_reauth: c.needs_reauth })),
  })
}

// Thin proxies: the worker owns update + delete (with guards) under RLS.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => ({}))

  try {
    const res = await workerFetch(`/personas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken: session.access_token,
      json: payload,
    })
    const data = await res.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await workerFetch(`/personas/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken: session.access_token,
    })
    const data = await res.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
