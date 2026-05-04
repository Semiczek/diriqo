import { NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'

export async function GET() {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json(
      {
        error: 'Forbidden',
      },
      { status: 403 }
    )
  }

  return NextResponse.json({
    companyId: activeCompany.companyId,
    companyName: activeCompany.companyName,
    profileId: activeCompany.profileId,
    profileName: activeCompany.profileName,
    profileEmail: activeCompany.profileEmail,
    role: activeCompany.role,
    companyMemberships: activeCompany.companyMemberships,
  })
}

export async function POST(request: Request) {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json(
      {
        error: 'Forbidden',
      },
      { status: 403 }
    )
  }

  const payload = (await request.json().catch(() => null)) as {
    companyId?: string | null
  } | null
  const companyId = payload?.companyId?.trim() ?? ''
  const targetCompany = activeCompany.companyMemberships.find(
    (membership) => membership.companyId === companyId
  )

  if (!companyId || !targetCompany) {
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
