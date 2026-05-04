export const PUBLIC_OFFER_TOKEN_PATTERN = /^[a-f0-9]{32,128}$/i
export const PUBLIC_OFFER_VISITOR_ID_PATTERN = /^[a-f0-9]{16,128}$/i

export const TRACK_EVENT_TYPES = new Set([
  'offer_opened',
  'offer_engaged',
  'section_viewed',
  'section_expanded',
  'pricing_viewed',
  'cta_interested',
  'cta_revision',
  'cta_contact',
  'cta_not_interested',
])

export const TRACK_SECTION_KEYS = new Set([
  'intro',
  'customer_request',
  'our_solution',
  'work_description',
  'timeline',
  'payment_terms',
  'pricing',
])

export const RESPONSE_ACTION_TYPES = new Set([
  'interested',
  'contact_requested',
  'revision_requested',
  'not_interested',
])

export const MAX_TOKEN_LENGTH = 128
export const MAX_VISITOR_ID_LENGTH = 128
export const MAX_SECTION_KEY_LENGTH = 40
export const MAX_EVENT_VALUE_LENGTH = 120
export const MAX_REFERRER_LENGTH = 500
export const MAX_USER_AGENT_LENGTH = 500
export const MAX_NAME_LENGTH = 120
export const MAX_EMAIL_LENGTH = 160
export const MAX_PHONE_LENGTH = 40
export const MAX_NOTE_LENGTH = 2000
export const MAX_HONEYPOT_LENGTH = 200

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const PHONE_ALLOWED_PATTERN = /^[0-9+\-()./\s]{6,40}$/

export function isLikelyPublicOfferToken(value: string | null | undefined) {
  if (!value) return false
  const normalized = value.trim()
  return normalized.length <= MAX_TOKEN_LENGTH && PUBLIC_OFFER_TOKEN_PATTERN.test(normalized)
}

export function normalizeVisitorId(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > MAX_VISITOR_ID_LENGTH) return null
  if (!PUBLIC_OFFER_VISITOR_ID_PATTERN.test(normalized)) return null
  return normalized
}

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

export function isAllowedTrackEventType(value: string | null | undefined) {
  return Boolean(value && TRACK_EVENT_TYPES.has(value))
}

export function isAllowedTrackSectionKey(value: string | null | undefined) {
  return Boolean(value && TRACK_SECTION_KEYS.has(value))
}

export function isAllowedResponseActionType(value: string | null | undefined) {
  return Boolean(value && RESPONSE_ACTION_TYPES.has(value))
}

export function isValidCustomerEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value)
}

export function isValidCustomerPhone(value: string) {
  return value.length <= MAX_PHONE_LENGTH && PHONE_ALLOWED_PATTERN.test(value)
}

export function normalizeReferrer(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value, MAX_REFERRER_LENGTH)
  if (!normalized) return null
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized
  }
  return null
}
