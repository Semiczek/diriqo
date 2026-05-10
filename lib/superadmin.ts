import 'server-only'

import { redirect } from 'next/navigation'

import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export type SuperadminContext = {
  profileId: string
  email: string | null
  name: string | null
}

export async function requireSuperAdmin(): Promise<SuperadminContext> {
  const activeCompany = await getActiveCompanyContext({ allowedRoles: ['super_admin'] })

  if (!activeCompany || (activeCompany.role ?? '').trim().toLowerCase() !== 'super_admin') {
    redirect('/sign-in?error=no-hub-access')
  }

  return {
    profileId: activeCompany.profileId,
    email: activeCompany.profileEmail,
    name: activeCompany.profileName,
  }
}

export async function logSuperadminAction(input: {
  superadminProfileId: string
  companyId?: string | null
  action: string
  reason?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('superadmin_audit_log').insert({
    superadmin_user_id: input.superadminProfileId,
    company_id: input.companyId ?? null,
    action: input.action,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
}
