import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getIngestionJob } from '@/lib/db/ingestion'
import { getPersona } from '@/lib/db/personas'
import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'
import { createContentItem, createPostVariants } from '@/lib/db/posts'
import {
  createCampaign, updateCampaign, createCampaignPersonas, createCampaignPersonaVariants,
  countRecentCampaigns, listCampaignsForWorkspace,
} from '@/lib/db/campaigns'
import { insertAuditEvent } from '@/lib/db/audit-events'
import { workerGenerate, type WorkerGenerateResponse } from '@/lib/worker-client'
import { SUPPORTED_PLATFORMS, PERSONA_SOFT_CAP, type Platform } from '@/lib/constants/platforms'
import type { Database } from '@/lib/db/types'

type BrandConfigRow = Database['public']['Tables']['brand_configs']['Row']
type SocialConnectionRow = Database['public']['Tables']['social_connections']['Row']
type IngestionJobRow = Database['public']['Tables']['ingestion_jobs']['Row']

const bodySchema = z.object({
  ingestion_job_id: z.string().uuid(),
  persona_ids: z.array(z.string().uuid()).min(1).max(PERSONA_SOFT_CAP),
  platforms: z.array(z.enum(SUPPORTED_PLATFORMS)).optional(),
  // Optional user-supplied angle. Stored on the campaign and threaded
  // through to the worker so it can shape every persona's variant.
  user_angle: z.string().trim().min(1).max(1000).optional(),
})

async function generateForPersona(params: {
  personaId: string
  brand: BrandConfigRow
  connections: SocialConnectionRow[]
  requestedPlatforms?: Platform[]
  job: IngestionJobRow
  workspaceId: string
  userAngle?: string | null
}): Promise<{ personaId: string; workerResult?: WorkerGenerateResponse; error?: string }> {
  const connectedPlatforms = params.connections
    .filter(c => !c.needs_reauth)
    .map(c => c.platform) as Platform[]

  const platforms = params.requestedPlatforms
    ? params.requestedPlatforms.filter(p => connectedPlatforms.includes(p))
    : connectedPlatforms

  if (platforms.length === 0) {
    return { personaId: params.personaId, error: 'No connected platforms' }
  }

  // [B3] AbortController so the fetch is actually cancelled on timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const workerResult = await workerGenerate(
      {
        workspace_id: params.workspaceId,
        extracted_title: params.job.extracted_title ?? '',
        extracted_text: params.job.extracted_text ?? '',
        brand_system_prompt: params.brand.custom_system_prompt!,
        platforms,
        user_angle: params.userAngle ?? null,
      },
      controller.signal
    )
    return { personaId: params.personaId, workerResult }
  } catch (err) {
    return { personaId: params.personaId, error: err instanceof Error ? err.message : 'Failed' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  const workspaceId = workspace.workspace_id

  // [A23] Rate limit: 2 campaigns per minute per workspace
  const perMinute = await countRecentCampaigns(workspaceId, 60)
  if (perMinute >= 2) {
    return NextResponse.json({ error: 'Rate limit: 2 campaigns per minute' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const {
    ingestion_job_id,
    persona_ids,
    platforms: requestedPlatforms,
    user_angle: userAngle,
  } = parsed.data

  const job = await getIngestionJob(ingestion_job_id)
  if (!job || job.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.stage !== 'done') {
    return NextResponse.json({ error: 'Ingestion not ready' }, { status: 409 })
  }
  // [S1] We need something to generate from: either extracted source
  // material OR a user-supplied angle (prompt-only flow).
  const hasExtractedText = Boolean(job.extracted_text?.trim())
  const hasUserAngle = Boolean(userAngle && userAngle.trim())
  if (!hasExtractedText && !hasUserAngle) {
    return NextResponse.json(
      { error: 'Ingestion job has no extracted text and no user angle was provided' },
      { status: 409 }
    )
  }

  // Validate all personas belong to this workspace
  const personas = await Promise.all(persona_ids.map(id => getPersona(id)))
  const invalidPersona = personas.find(p => !p || p.workspace_id !== workspaceId)
  if (invalidPersona !== undefined) {
    return NextResponse.json({ error: 'Invalid persona' }, { status: 403 })
  }

  const [brandConfigs, connectionsByPersona] = await Promise.all([
    Promise.all(persona_ids.map(id => getBrandConfigForPersona(id))),
    Promise.all(persona_ids.map(id => getConnectionsForPersona(id))),
  ])

  const missingBrandIdx = persona_ids.findIndex((_, i) => !brandConfigs[i]?.custom_system_prompt)
  if (missingBrandIdx !== -1) {
    return NextResponse.json(
      { error: 'One or more personas have no voice profile set' }, { status: 409 }
    )
  }

  // Prompt-only flow: a text job carrying a user angle means the user typed a
  // prompt rather than pasting an article. The angle IS the topic, so don't
  // also feed the echoed prompt back as "source material" — that would make
  // the worker summarize a one-liner and double-count it. URL jobs and pasted-
  // text jobs without an angle keep their extracted text.
  const effectiveJob =
    job.source_type === 'text' && hasUserAngle
      ? { ...job, extracted_text: '' }
      : job

  const campaign = await createCampaign({
    workspace_id: workspaceId,
    ingestion_job_id,
    title: job.extracted_title ?? undefined,
    status: 'generating',
    generation_started_at: new Date().toISOString(),
    user_angle: userAngle ?? null,
  })

  const campaignPersonaRows = await createCampaignPersonas(campaign.id, persona_ids)
  const campaignPersonaByPersonaId = Object.fromEntries(
    campaignPersonaRows.map(row => [row.persona_id, row])
  )

  // Fire generation in parallel — one per persona
  const generationResults = await Promise.allSettled(
    persona_ids.map((personaId, idx) =>
      generateForPersona({
        personaId,
        brand: brandConfigs[idx]!,
        connections: connectionsByPersona[idx] ?? [],
        requestedPlatforms,
        job: effectiveJob,
        workspaceId,
        userAngle: userAngle ?? null,
      })
    )
  )

  const allVariants: Array<{
    personaId: string; platform: string; variantId: string; body: string
  }> = []
  let successCount = 0

  for (const result of generationResults) {
    if (result.status === 'rejected') continue

    const { personaId, workerResult, error } = result.value
    const campaignPersona = campaignPersonaByPersonaId[personaId]

    if (error || !workerResult) {
      await supabase
        .from('campaign_personas')
        .update({ generation_error: error ?? 'Generation failed' })
        .eq('id', campaignPersona.id)
      continue
    }

    // [B2] ONE content_item per persona (not per variant/platform)
    const promptVersionId =
      brandConfigs[persona_ids.indexOf(personaId)]?.current_prompt_version_id ?? null
    const contentItem = await createContentItem({
      workspace_id: workspaceId,
      ingestion_job_id,
      prompt_version_id: promptVersionId,
    })

    const postVariants = await createPostVariants(
      workerResult.variants.map(v => ({
        workspace_id: workspaceId,
        content_item_id: contentItem.id,
        platform: v.platform,
        body: v.body,
        status: 'draft' as const,
        persona_id: personaId,
      }))
    )

    // [B1] Link all variants to campaign_persona via join table.
    // prompt_version_id is snapshotted here so a later voice refresh
    // doesn't silently desync the variant's voice-of-origin.
    await createCampaignPersonaVariants(
      campaignPersona.id,
      postVariants.map(v => ({
        post_variant_id: v.id,
        platform: v.platform,
        prompt_version_id: promptVersionId,
      }))
    )

    postVariants.forEach(v => allVariants.push({
      personaId, platform: v.platform, variantId: v.id, body: v.body,
    }))
    successCount++
  }

  // [B8] generation_partial (not partially_approved)
  const finalStatus = successCount === 0
    ? 'failed'
    : successCount < persona_ids.length
    ? 'generation_partial'
    : 'pending_approval'

  await updateCampaign(
    campaign.id,
    successCount === 0
      ? {
          status: finalStatus,
          failure_code: 'ALL_PERSONAS_FAILED',
          failure_reason: 'Every persona generation attempt failed. Check that each persona has a connected platform and a voice profile.',
        }
      : { status: finalStatus }
  )
  await insertAuditEvent({
    workspace_id: workspaceId,
    event_type: 'campaign.created',
    entity_type: 'campaign',
    entity_id: campaign.id,
    metadata: { persona_count: persona_ids.length, success_count: successCount },
  })

  if (successCount === 0) {
    return NextResponse.json(
      { error: 'All persona generation attempts failed', campaign_id: campaign.id },
      { status: 502 }
    )
  }

  const personaMap = Object.fromEntries(
    personas.filter(Boolean).map(p => [p!.id, p!])
  )

  return NextResponse.json({
    campaign_id: campaign.id,
    status: finalStatus,
    variants: allVariants.map(v => ({
      persona_id: v.personaId,
      persona_name: personaMap[v.personaId]?.name ?? 'Unknown',
      platform: v.platform,
      variant_id: v.variantId,
      body: v.body,
    })),
  })
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
