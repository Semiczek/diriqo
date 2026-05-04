export const LOCALES = ['cs', 'en', 'de'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'cs'
export const LOCALE_COOKIE_NAME = 'diriqo-locale'
export const LOCALE_HEADER_NAME = 'x-diriqo-locale'
export const LOCALE_COUNTRY_HEADER_NAME = 'x-diriqo-locale-country'

const GERMAN_SPEAKING_COUNTRIES = new Set(['DE', 'AT', 'CH', 'LI', 'LU'])
const CZECH_DEFAULT_COUNTRIES = new Set(['CZ', 'SK'])

export function isLocale(value: string | null | undefined): value is Locale {
  if (!value) return false
  return LOCALES.includes(value as Locale)
}

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null

  const normalized = value.trim().toLowerCase()

  if (isLocale(normalized)) {
    return normalized
  }

  if (normalized.startsWith('cs')) return 'cs'
  if (normalized.startsWith('sk')) return 'cs'
  if (normalized.startsWith('en')) return 'en'
  if (normalized.startsWith('de')) return 'de'

  return null
}

export function resolveLocale(value: string | null | undefined): Locale {
  return normalizeLocale(value) ?? DEFAULT_LOCALE
}

export function getPreferredLocaleFromHeader(
  acceptLanguage: string | null | undefined
): Locale | null {
  if (!acceptLanguage) return null

  const candidates = acceptLanguage.split(',').map((part) => part.split(';')[0]?.trim())

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate)

    if (locale) {
      return locale
    }
  }

  return null
}

export function getFallbackLocaleFromCountry(countryCode: string | null | undefined): Locale {
  const normalized = countryCode?.trim().toUpperCase()

  if (!normalized) {
    return DEFAULT_LOCALE
  }

  if (CZECH_DEFAULT_COUNTRIES.has(normalized)) {
    return 'cs'
  }

  if (GERMAN_SPEAKING_COUNTRIES.has(normalized)) {
    return 'de'
  }

  return 'cs'
}

export function getIntlLocale(locale: Locale): string {
  if (locale === 'en') return 'en-GB'
  if (locale === 'de') return 'de-DE'
  return 'cs-CZ'
}
