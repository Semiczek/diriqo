import { NextResponse } from 'next/server'

import { getSubscriptionAccessState } from '@/lib/subscription'
import { requireActiveCompanyContext } from '@/lib/server-guards'

export async function GET() {
  const activeCompanyResult = await requireActiveCompanyContext({
    allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'],
  })

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const access = await getSubscriptionAccessState(activeCompanyResult.value.companyId)

  return NextResponse.json(access)
}
