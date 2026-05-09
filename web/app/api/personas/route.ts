import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { getPersonasForWorkspace, createPersona } from '@/lib/db/personas'
import { PERSONA_SOFT_CAP } from '@/lib/constants/platforms'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const personas = await getPersonasForWorkspace(workspace.workspace_id)
  return NextResponse.json({ personas })
}

const createSchema = z.object({
  name: z.string().min(1).max(50),
  avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const personas = await getPersonasForWorkspace(workspace.workspace_id)
  if (personas.length >= PERSONA_SOFT_CAP) {
    return NextResponse.json(
      { error: `Workspace has reached the ${PERSONA_SOFT_CAP}-persona limit` },
      { status: 400 }
    )
  }

  try {
    const persona = await createPersona(
      workspace.workspace_id, parsed.data.name, parsed.data.avatar_color
    )
    return NextResponse.json({ persona }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create persona'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
