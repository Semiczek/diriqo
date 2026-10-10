import 'server-only'

import type { SupabaseServerClient } from '../dal/auth'

/** Uses the caller's authenticated client. Tenant roles never grant platform access. */
export async function hasPlatformAdminAccess(client: Pick<SupabaseServerClient, 'rpc'>): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('is_super_admin')
    return !error && data === true
  } catch {
    return false
  }
}
