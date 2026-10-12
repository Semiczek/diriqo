// Conservative transport limits below Vercel's 4.5 MB envelope, including JSON/base64.
export const OFFICE_HOST_REQUEST_BYTES = 3_800_000
export const OFFICE_HOST_UPLOAD_BYTES = 3 * 1024 * 1024
export const OFFICE_HOST_RESPONSE_BYTES = 4_350_000
export const OFFICE_HOST_MUTATION_BYTES = OFFICE_HOST_RESPONSE_BYTES - 65_536
export function assertOfficeHostPayload(value: unknown, maxBytes = OFFICE_HOST_REQUEST_BYTES) {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { throw new Error('OFFICE_HOST_LIMIT') }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new Error('OFFICE_HOST_LIMIT')
  }
}
export function assertOfficeHostUpload(value: unknown) {
  if (!(value instanceof File) || value.size > OFFICE_HOST_UPLOAD_BYTES) throw new Error('OFFICE_HOST_LIMIT')
}
/** Trusted deployment metadata only; never derive CSRF origin from request headers. */
export function officePublicOrigin() {
  const configured = process.env.OFFICE_PUBLIC_ORIGIN
  if (configured !== undefined) {
    try {
      const url = new URL(configured)
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (url.origin !== configured || url.username || url.password || (!localHttp && url.protocol !== 'https:')) throw new Error()
      return url.origin
    } catch { throw new Error('OFFICE_ORIGIN_CONFIGURATION') }
  }
  const host = process.env.VERCEL_URL
  if (process.env.VERCEL === '1' && host && /^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(host)) return 'https://' + host
  return undefined
}
