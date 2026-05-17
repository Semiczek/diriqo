import { NextResponse } from 'next/server'

import { getRequestLocale } from '@/lib/i18n/server'
import {
  getClientIpFromHeaders,
  getPendingLegalDocuments,
  recordCurrentLegalAcceptancesForUser,
} from '@/lib/legal'
import { requireAuthenticatedUser } from '@/lib/server-guards'

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser()

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const locale = await getRequestLocale()
  const pending = await getPendingLegalDocuments(auth.value.user.id, locale)

  if (pending.length === 0) {
    return NextResponse.json({ accepted: true, stored: [] })
  }

  const headers = request.headers
  const stored = await recordCurrentLegalAcceptancesForUser({
    userId: auth.value.user.id,
    locale,
    documentTypes: pending.map((document) => document.type),
    ipAddress: getClientIpFromHeaders(headers),
    userAgent: headers.get('user-agent'),
  })

  const failed = stored.filter((result) => !result.stored)
  if (failed.length > 0) {
    return NextResponse.json(
      {
        accepted: false,
        error: 'Legal acceptance could not be stored.',
        failed,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ accepted: true, stored })
}
