import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workerUpsertCadence } from '@/lib/worker-client'

// Thin proxy: auth gate + forward the cadence config to the worker, which
// validates with Pydantic and upserts under RLS. No Zod (worker re-validates).
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    const workerRes = await workerUpsertCadence(payload, session.access_token)
    const data = await workerRes.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: workerRes.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
