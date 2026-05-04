import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isLocale,
  type Locale,
} from '@/lib/i18n/config'

export async function POST(request: Request) {
  let locale: Locale = DEFAULT_LOCALE

  try {
    const payload = (await request.json()) as { locale?: string }

    if (isLocale(payload.locale)) {
      locale = payload.locale
    }
  } catch {
  }

  const cookieStore = await cookies()

  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })

  return NextResponse.json({ ok: true, locale })
}
