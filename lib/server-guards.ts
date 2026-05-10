import 'server-only'

import {
  getActiveCompanyContext,
  type ActiveCompanyContext,
  type ActiveCompanyContextOptions,
} from '@/lib/active-company'
import { hasHubAccessRole, normalizeCompanyRole } from '@/lib/hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type GuardResult<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      status: 401 | 403
      error: string
    }

export type CompanyRole = 'super_admin' | 'company_admin' | 'manager' | 'worker'

export async function requireAuthenticatedUser() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required',
    } satisfies GuardResult<never>
  }

  return {
    ok: true,
    value: {
      supabase,
      user: data.user,
    },
  } satisfies GuardResult<{
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
    user: typeof data.user
  }>
}

export async function requireActiveCompanyContext(options: ActiveCompanyContextOptions = {}) {
  const activeCompany = await getActiveCompanyContext(options)

  if (!activeCompany) {
    return {
      ok: false,
      status: 403,
      error: 'Active company access required',
    } satisfies GuardResult<never>
  }

  return {
    ok: true,
    value: activeCompany,
  } satisfies GuardResult<ActiveCompanyContext>
}

export async function requireCompanyRole(...roles: CompanyRole[]) {
  const activeCompanyResult = await requireActiveCompanyContext({ allowedRoles: roles })

  if (!activeCompanyResult.ok) {
    return activeCompanyResult
  }

  const normalizedRole = normalizeCompanyRole(activeCompanyResult.value.role)

  if (!roles.includes(normalizedRole as CompanyRole)) {
    return {
      ok: false,
      status: 403,
      error: 'Insufficient company role',
    } satisfies GuardResult<never>
  }

  return activeCompanyResult
}

export async function requireHubAccess() {
  const activeCompanyResult = await requireActiveCompanyContext()

  if (!activeCompanyResult.ok) {
    return activeCompanyResult
  }

  if (!hasHubAccessRole(activeCompanyResult.value.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Hub access required',
    } satisfies GuardResult<never>
  }

  return activeCompanyResult
}

export async function requireWorkerAccess() {
  return requireCompanyRole('worker', 'manager', 'company_admin', 'super_admin')
}

export async function requirePortalAccess() {
  const authResult = await requireAuthenticatedUser()

  if (!authResult.ok) {
    return authResult
  }

  const { supabase, user } = authResult.value
  const { data, error } = await supabase
    .from('customer_portal_users')
    .select('id, customer_id, contact_id, email, is_active')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data?.id) {
    return {
      ok: false,
      status: 403,
      error: 'Portal access required',
    } satisfies GuardResult<never>
  }

  return {
    ok: true,
    value: {
      supabase,
      user,
      portalUser: data,
    },
  } satisfies GuardResult<{
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
    user: typeof user
    portalUser: typeof data
  }>
}
