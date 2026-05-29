import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workerAtomize } from '@/lib/worker-client'

// Thin proxy: auth gate + forward the user's JWT to the worker, which owns the
// atomization flow (LLM idea extraction + content_ideas/content_items writes)
// under RLS. The worker re-validates the body with Pydantic, so no Zod here.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    const workerRes = await workerAtomize(payload, session.access_token)
    const data = await workerRes.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: workerRes.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
