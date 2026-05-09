import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type AuditEventInsert = Database['public']['Tables']['audit_events']['Insert']

// CRITICAL: This function MUST NEVER throw. Audit logging must never break
// the main application flow. All errors are silently swallowed.
export async function insertAuditEvent(event: AuditEventInsert): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('audit_events').insert(event)
  } catch {
    // Audit must never break the main flow — silent swallow
  }
}
