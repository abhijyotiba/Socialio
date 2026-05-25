import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workerFetch } from '@/lib/worker-client'

// Thin proxy: the worker approves one persona in the campaign under RLS.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; persona_id: string }> }
) {
  const { id, persona_id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await workerFetch(
      `/campaigns/${encodeURIComponent(id)}/persona/${encodeURIComponent(persona_id)}/approve`,
      { method: 'POST', accessToken: session.access_token }
    )
    const data = await res.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
