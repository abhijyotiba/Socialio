import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/db/types'

type PersonaRow = Database['public']['Tables']['personas']['Row']

// Create / update / delete (with caps, slug generation, and delete guards) live
// in the Python worker (worker/db/personas.py). These reads remain in the web
// layer for the GET routes and other consumers (OAuth, queue, settings, etc.).

export async function getPersonasForWorkspace(workspaceId: string): Promise<PersonaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('personas').select('*').eq('workspace_id', workspaceId)
    .order('is_default', { ascending: false }).order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getPersona(id: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('personas').select('*').eq('id', id).single()
  return data
}

export async function getDefaultPersona(workspaceId: string): Promise<PersonaRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('personas').select('*').eq('workspace_id', workspaceId).eq('is_default', true).single()
  return data
}
