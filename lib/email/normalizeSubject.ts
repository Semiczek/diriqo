// Accept legacy JSPD tokens so replies to older outbound e-mails can still thread correctly.
const TOKEN_REGEX = /\[(?:DIRIQO|JSPD):T:([A-Za-z0-9_-]+)\]/i
const PREFIX_REGEX = /^\s*((re|fw|fwd)\s*:\s*)+/i

export function extractTrackingTokenFromSubject(subject: string | null | undefined) {
  if (!subject) return null

  const match = subject.match(TOKEN_REGEX)
  return match?.[1] ?? null
}

export function stripTrackingTokenFromSubject(subject: string | null | undefined) {
  if (!subject) return ''

  return subject.replace(TOKEN_REGEX, '').replace(/\s{2,}/g, ' ').trim()
}

export function normalizeSubject(subject: string | null | undefined) {
  const withoutToken = stripTrackingTokenFromSubject(subject)
  const withoutPrefixes = withoutToken.replace(PREFIX_REGEX, '')
  return withoutPrefixes.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function appendTrackingTokenToSubject(subject: string, trackingToken: string) {
  const cleaned = stripTrackingTokenFromSubject(subject)
  return `${cleaned} [DIRIQO:T:${trackingToken}]`.trim()
}
