import 'server-only'

import { redirect } from 'next/navigation'

import { getActiveCompanyContext } from '@/lib/active-company'

export async function requireHubAccess() {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    redirect('/login?error=no-hub-access')
  }

  return activeCompany
}
