import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase-server'
/** UI hint only. Every Office server operation independently enforces the flag. */
export async function readOfficeAvailability(companyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('office_settings').select('enabled').eq('company_id', companyId).maybeSingle()
  return !error && data?.enabled === true
}
