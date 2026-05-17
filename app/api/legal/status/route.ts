import { NextResponse } from 'next/server'

import { getRequestLocale } from '@/lib/i18n/server'
import {
  getPendingLegalDocuments,
  isLegalAcceptanceStorageAvailable,
} from '@/lib/legal'
import { requireAuthenticatedUser } from '@/lib/server-guards'

export async function GET() {
  const auth = await requireAuthenticatedUser()

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const locale = await getRequestLocale()
  const storageAvailable = await isLegalAcceptanceStorageAvailable()
  const pending = storageAvailable
    ? await getPendingLegalDocuments(auth.value.user.id, locale)
    : []

  return NextResponse.json({
    storageAvailable,
    requiresAcceptance: pending.length > 0,
    pending: pending.map((document) => ({
      type: document.type,
      title: document.title,
      version: document.version,
      publishedAt: document.publishedAt,
    })),
  })
}
