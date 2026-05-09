import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getCampaignWithPersonas, updateCampaignPersonaApproval, updateCampaign } from '@/lib/db/campaigns'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; persona_id: string }> }
) {
  const { id, persona_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const campaign = await getCampaignWithPersonas(id)
  if (!campaign || campaign.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cp = campaign.campaign_personas.find(cp => cp.persona_id === persona_id)
  if (!cp) return NextResponse.json({ error: 'Persona not in campaign' }, { status: 404 })

  // Rejection does NOT delete variants — just marks status
  await updateCampaignPersonaApproval(cp.id, 'rejected')

  const updated = await getCampaignWithPersonas(id)
  const allResolved = updated?.campaign_personas.every(cp => cp.approval_status !== 'pending')
  if (allResolved) await updateCampaign(id, { status: 'approved' })

  return NextResponse.json({ ok: true })
}
