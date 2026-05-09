import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import {
  getCampaignWithPersonas, updateCampaignPersonaApproval,
  getVariantsForCampaignPersona, updateCampaign,
} from '@/lib/db/campaigns'
import { insertAuditEvent } from '@/lib/db/audit-events'

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

  await updateCampaignPersonaApproval(cp.id, 'approved')

  const variantIds = await getVariantsForCampaignPersona(cp.id)
  if (variantIds.length > 0) {
    await supabase.from('post_variants').update({ status: 'scheduled' }).in('id', variantIds)
  }

  await insertAuditEvent({
    workspace_id: workspace.workspace_id,
    persona_id,
    actor_user_id: user.id,
    event_type: 'campaign_persona.approved',
    entity_type: 'campaign_persona',
    entity_id: cp.id,
  })

  const updated = await getCampaignWithPersonas(id)
  const allResolved = updated?.campaign_personas.every(cp => cp.approval_status !== 'pending')
  if (allResolved) await updateCampaign(id, { status: 'approved' })

  return NextResponse.json({ ok: true })
}
