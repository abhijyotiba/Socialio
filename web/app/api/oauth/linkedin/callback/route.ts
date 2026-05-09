import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens, getUserInfo } from '@/lib/adapters/linkedin'
import { createSecret } from '@/lib/security/vault'
import { getWorkspaceForUser } from '@/lib/db/workspaces'
import { upsertSocialConnection } from '@/lib/db/social-connections'
import { getPersona } from '@/lib/db/personas'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('linkedin_oauth_state')?.value
  if (!savedState || savedState !== state) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // [B5] Use indexOf + slice — safe against UUIDs or future format changes.
  // Never use split(':')[1] — would silently return undefined on malformed state.
  const colonIdx = savedState.indexOf(':')
  if (colonIdx === -1) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }
  const personaId = savedState.slice(colonIdx + 1)
  if (!personaId) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }

  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 403 })
  }

  // Defense in depth — re-validate persona ownership even though we validated at start
  const persona = await getPersona(personaId)
  if (!persona || persona.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: 'Persona mismatch' }, { status: 403 })
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch {
    return NextResponse.json({ error: 'LinkedIn token exchange failed' }, { status: 502 })
  }

  // Delete cookie only after successful exchange — user can retry on failure
  cookieStore.delete('linkedin_oauth_state')

  const admin = createAdminClient()
  const workspaceId = workspace.workspace_id

  const accessVaultId = await createSecret(
    admin,
    tokens.access_token,
    `linkedin:access:${workspaceId}:${personaId}`
  )

  let refreshVaultId: string | null = null
  if (tokens.refresh_token) {
    refreshVaultId = await createSecret(
      admin,
      tokens.refresh_token,
      `linkedin:refresh:${workspaceId}:${personaId}`
    )
  }

  let platformUserId: string | null = null
  let platformUsername: string | null = null
  try {
    const info = await getUserInfo(tokens.access_token)
    platformUserId = info.sub
    platformUsername = info.name ?? info.email ?? null
  } catch {
    // Profile fetch failure is non-fatal; connection is still stored.
  }

  const tokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString()

  await upsertSocialConnection(
    {
      workspace_id: workspaceId,
      persona_id: personaId,
      platform: 'linkedin',
      platform_user_id: platformUserId,
      platform_username: platformUsername,
      access_token_vault_id: accessVaultId,
      refresh_token_vault_id: refreshVaultId,
      token_expires_at: tokenExpiresAt,
      needs_reauth: false,
    },
    admin
  )

  return NextResponse.redirect(
    new URL(`/settings/personas/${personaId}/connections?linkedin=connected`, request.url)
  )
}
