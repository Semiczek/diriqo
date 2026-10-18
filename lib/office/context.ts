import 'server-only'
import { getActiveCompanyContext, getCompanyContextForSwitch, type ActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { OfficeActor } from '@diriqo/office/core'

export async function requireOfficeContext(write = false) {
  const active = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'] })
  return validateOfficeContext(active, write)
}

/** Switching checks the new company's permissions, even if the old selection expired. */
export async function requireOfficeCompanySwitchContext(companyId: string) {
  return validateOfficeContext(await getCompanyContextForSwitch(companyId), false)
}

async function validateOfficeContext(active: ActiveCompanyContext | null, write: boolean) {
  if (!active) throw new Error('OFFICE_FORBIDDEN')
  const supabase = await createSupabaseServerClient()
  const auth = await supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw new Error('OFFICE_UNAUTHENTICATED')

  // Match office_host_context: legacy-only or conflicting identity bindings fail closed.
  const identity = await supabase.from('profiles')
    .select('id,auth_user_id,user_id')
    .eq('id', active.profileId)
    .eq('auth_user_id', auth.data.user.id)
    .maybeSingle()
  if (identity.error || !identity.data
    || identity.data.auth_user_id !== auth.data.user.id
    || (identity.data.user_id !== null && identity.data.user_id !== identity.data.auth_user_id)) {
    throw new Error('OFFICE_IDENTITY_MISMATCH')
  }

  const role = (active.role ?? '').trim().toLowerCase()
  if (!['super_admin', 'company_admin', 'manager', 'worker'].includes(role)) throw new Error('OFFICE_FORBIDDEN')
  const { data, error } = await supabase.from('office_settings').select('enabled').eq('company_id', active.companyId).maybeSingle()
  if (error || data?.enabled !== true) throw new Error('OFFICE_DISABLED')
  const actor: OfficeActor = { tenantId: active.companyId, actorId: active.profileId, role: ['super_admin', 'company_admin'].includes(role) ? 'owner' : role === 'manager' ? 'editor' : 'reader', enabled: true, principal: 'human' }
  // Office is a base feature. Membership, role and the company kill switch still apply.
  if (write && actor.role === 'reader') throw new Error('OFFICE_FORBIDDEN')
  return { supabase, actor, active }
}
