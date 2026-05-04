import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Chybí NEXT_PUBLIC_SUPABASE_URL v .env.local')
  }

  if (!serviceRoleKey) {
    throw new Error('Chybí SUPABASE_SERVICE_ROLE_KEY v .env.local')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}