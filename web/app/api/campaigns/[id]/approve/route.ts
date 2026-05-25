import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workerFetch } from '@/lib/worker-client'

// Thin proxy: the worker owns the approval state machine (mark approved,
// schedule variants, audit, roll campaign to 'approved') under RLS.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => ({}))

  try {
    const res = await workerFetch(`/campaigns/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      accessToken: session.access_token,
      json: payload,
    })
    const data = await res.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
