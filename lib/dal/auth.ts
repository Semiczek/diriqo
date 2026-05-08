import 'server-only'

import { requireCompanyRole, requireHubAccess, type CompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type DalContext = {
  supabase: SupabaseServerClient
  companyId: string
  profileId: string
  role: string | null
}

export class DalAuthError extends Error {
  constructor(message = 'Nemate opravneni k teto akci.') {
    super(message)
    this.name = 'DalAuthError'
  }
}

export async function requireHubDalContext(): Promise<DalContext> {
  const activeCompanyResult = await requireHubAccess()

  if (!activeCompanyResult.ok) {
    throw new DalAuthError(activeCompanyResult.error)
  }

  const supabase = await createSupabaseServerClient()
  const activeCompany = activeCompanyResult.value

  return {
    supabase,
    companyId: activeCompany.companyId,
    profileId: activeCompany.profileId,
    role: activeCompany.role,
  }
}

export async function requireCompanyRoleDalContext(...roles: CompanyRole[]): Promise<DalContext> {
  const activeCompanyResult = await requireCompanyRole(...roles)

  if (!activeCompanyResult.ok) {
    throw new DalAuthError(activeCompanyResult.error)
  }

  const supabase = await createSupabaseServerClient()
  const activeCompany = activeCompanyResult.value

  return {
    supabase,
    companyId: activeCompany.companyId,
    profileId: activeCompany.profileId,
    role: activeCompany.role,
  }
}
