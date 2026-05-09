import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersona, updatePersona, deletePersona } from '@/lib/db/personas'
import { getBrandConfigForPersona } from '@/lib/db/brand-configs'
import { getConnectionsForPersona } from '@/lib/db/social-connections'

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

const patchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function PATCH(
  request: Request,
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

  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  await updatePersona(id, parsed.data)
  return NextResponse.json({ ok: true })
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

  const persona = await getPersona(id)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await deletePersona(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}
