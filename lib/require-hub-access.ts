import 'server-only'

import { redirect } from 'next/navigation'

import { getActiveCompanyContext } from '@/lib/active-company'
import { COMPANY_MEMBER_ROLES, hasHubAccessRole } from '@/lib/hub-access'

export async function requireHubAccess() {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    const memberCompany = await getActiveCompanyContext({ allowedRoles: COMPANY_MEMBER_ROLES })
    if (memberCompany && !hasHubAccessRole(memberCompany.role)) redirect('/moje-prace')
    redirect('/onboarding/company')
  }

  if (!hasHubAccessRole(activeCompany.role)) {
    redirect('/sign-in?error=no-hub-access')
  }

  return activeCompany
}
