import { NextResponse } from 'next/server'

import { getActiveCompanyContext, getCompanyContextForSwitch } from '@/lib/active-company'
import { readOfficeAvailability } from '@/lib/office/availability'
import { requireAuthenticatedUser } from '@/lib/server-guards'

export async function GET() {
  const activeCompany = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'] })

  if (!activeCompany) {
    return NextResponse.json(
      {
        error: 'Forbidden',
      },
      { status: 403 }
    )
  }

  return NextResponse.json({
    officeEnabled: await readOfficeAvailability(activeCompany.companyId),
    companyId: activeCompany.companyId,
    companyName: activeCompany.companyName,
    timeZone: activeCompany.timeZone,
    profileId: activeCompany.profileId,
    profileName: activeCompany.profileName,
    profileEmail: activeCompany.profileEmail,
    role: activeCompany.role,
    companyMemberships: activeCompany.companyMemberships,
  })
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser()

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: 'Forbidden',
      },
      { status: 403 }
    )
  }

  const payload: unknown = await request.json().catch(() => null)
  const targetCompany = payload && typeof payload === 'object' && 'companyId' in payload
    && typeof payload.companyId === 'string'
    ? await getCompanyContextForSwitch(payload.companyId)
    : null

  if (!targetCompany) {
    return NextResponse.json(
      {
        error: 'Company not available',
      },
      { status: 400 }
    )
  }

  const response = NextResponse.json({
    companyId: targetCompany.companyId,
    companyName: targetCompany.companyName,
  })

  response.cookies.set({
    name: 'active_company_id',
    value: targetCompany.companyId,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })

  return response
}
