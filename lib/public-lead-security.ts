function getConfiguredPublicLeadSources() {
  // Keep jspd-cleaning-web accepted only when explicitly configured for old landing forms.
  return (process.env.PUBLIC_LEADS_ALLOWED_SOURCES ?? 'diriqo-web,diriqo-landing,demo-diriqo')
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean)
}

export const PUBLIC_LEAD_SOURCES = new Set(getConfiguredPublicLeadSources())
export const PUBLIC_LEAD_LOCALES = new Set(['cs', 'en', 'de'])

export const MAX_SOURCE_LENGTH = 80
export const MAX_LOCALE_LENGTH = 8
export const MAX_SERVICE_SLUG_LENGTH = 120
export const MAX_NAME_LENGTH = 120
export const MAX_COMPANY_LENGTH = 160
export const MAX_EMAIL_LENGTH = 160
export const MAX_PHONE_LENGTH = 40
export const MAX_MESSAGE_LENGTH = 4_000
export const MAX_URL_LENGTH = 500
export const MAX_REFERRER_LENGTH = 500
export const MAX_USER_AGENT_LENGTH = 500
export const MAX_HONEYPOT_LENGTH = 200

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const PHONE_ALLOWED_PATTERN = /^[0-9+\-()./\s]{6,40}$/
const SERVICE_SLUG_PATTERN = /^[a-z0-9-]{1,120}$/i

export function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

export function normalizeRequiredText(value: string | null | undefined, maxLength: number) {
  const normalized = normalizeOptionalText(value, maxLength)
  return normalized && normalized.length > 0 ? normalized : null
}

export function isAllowedPublicLeadSource(value: string | null | undefined) {
  return Boolean(value && PUBLIC_LEAD_SOURCES.has(value))
}

export function isAllowedPublicLeadLocale(value: string | null | undefined) {
  return Boolean(value && PUBLIC_LEAD_LOCALES.has(value))
}

export function normalizeServiceSlug(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value, MAX_SERVICE_SLUG_LENGTH)
  if (!normalized) return null
  if (!SERVICE_SLUG_PATTERN.test(normalized)) return null
  return normalized.toLowerCase()
}

export function isValidLeadEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value)
}

export function isValidLeadPhone(value: string) {
  return value.length <= MAX_PHONE_LENGTH && PHONE_ALLOWED_PATTERN.test(value)
}

export function normalizeHttpUrl(value: string | null | undefined, maxLength = MAX_URL_LENGTH) {
  const normalized = normalizeOptionalText(value, maxLength)
  if (!normalized) return null
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized
  }
  return null
}

export function normalizeLeadSubmittedAt(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value, 64)
  if (!normalized) return new Date().toISOString()

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }

  return parsed.toISOString()
}
