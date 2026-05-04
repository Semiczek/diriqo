import 'server-only'

export function buildTrackingToken() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}
