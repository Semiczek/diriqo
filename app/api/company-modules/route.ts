import { NextResponse } from 'next/server'

import { getCompanyModules } from '@/lib/company-settings'
import { requireHubAccess } from '@/lib/server-guards'

export async function GET() {
  const access = await requireHubAccess()

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const modules = await getCompanyModules(access.value.companyId)

  return NextResponse.json({ modules })
}
