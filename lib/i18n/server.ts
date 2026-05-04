import 'server-only'

import { cookies, headers } from 'next/headers'

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  resolveLocale,
  type Locale,
} from './config'
import { getDictionary } from './dictionaries'
import type { TranslationDictionary } from './dictionaries/types'

export async function getRequestLocale(): Promise<Locale> {
  const headerStore = await headers()
  const headerLocale = headerStore.get(LOCALE_HEADER_NAME)

  if (headerLocale) {
    return resolveLocale(headerLocale)
  }

  const cookieStore = await cookies()
  return resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE)
}

export async function getRequestDictionary(): Promise<TranslationDictionary> {
  const locale = await getRequestLocale()
  return getDictionary(locale)
}
