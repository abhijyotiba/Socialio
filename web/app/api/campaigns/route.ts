import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { listCampaignsForWorkspace } from '@/lib/db/campaigns'
import { workerCampaigns } from '@/lib/worker-client'

// Thin proxy: auth gate + forward the user's JWT to the worker, which owns the
// full generation flow (validation, rate-limiting, LLM orchestration, and the
// content_items/post_variants/campaign writes) under RLS.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    const workerRes = await workerCampaigns(payload, session.access_token)
    const data = await workerRes.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: workerRes.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaigns = await listCampaignsForWorkspace(workspace.workspace_id)
  return NextResponse.json({ campaigns })
}
