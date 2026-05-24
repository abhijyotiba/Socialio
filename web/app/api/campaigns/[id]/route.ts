import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import {
  deleteCampaign,
  getCampaignWithPersonas,
  hasLiveVariants,
} from '@/lib/db/campaigns'

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

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ campaign })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (await hasLiveVariants(id)) {
    return NextResponse.json(
      {
        error:
          'Cannot delete: this campaign has variants that are scheduled or already published. Cancel or wait for them to finish first.',
      },
      { status: 409 }
    )
  }

  await deleteCampaign(id)
  return NextResponse.json({ ok: true })
}
