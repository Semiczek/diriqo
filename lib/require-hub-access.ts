import 'server-only'

import { redirect } from 'next/navigation'

import { getActiveCompanyContext } from '@/lib/active-company'
import { hasHubAccessRole } from '@/lib/hub-access'

export async function requireHubAccess() {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    redirect('/onboarding/company')
  }

  if (!hasHubAccessRole(activeCompany.role)) {
    redirect('/sign-in?error=no-hub-access')
  }

  return activeCompany
}
