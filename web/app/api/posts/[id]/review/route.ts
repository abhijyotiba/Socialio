import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workerReviewPost } from '@/lib/worker-client'

// Thin proxy: forward a batch-review action (approve/reject) for a
// pending_approval variant to the worker, which validates the transition.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const payload = await request.json().catch(() => null)
  const action = payload?.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  try {
    const workerRes = await workerReviewPost(id, action, session.access_token)
    const data = await workerRes.json().catch(() => ({ error: 'Worker error' }))
    return NextResponse.json(data, { status: workerRes.status })
  } catch {
    return NextResponse.json({ error: 'Worker error' }, { status: 502 })
  }
}
