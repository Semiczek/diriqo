import 'server-only'

import { createHmac, timingSafeEqual } from 'crypto'

type MailgunSignatureInput = {
  timestamp: string | null
  token: string | null
  signature: string | null
}

function getSigningKey() {
  return process.env.MAILGUN_WEBHOOK_SIGNING_KEY?.trim() || ''
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyMailgunSignature(input: MailgunSignatureInput) {
  const signingKey = getSigningKey()
  const timestamp = input.timestamp?.trim() ?? ''
  const token = input.token?.trim() ?? ''
  const signature = input.signature?.trim() ?? ''

  if (!timestamp && !token && !signature && !signingKey) {
    return true
  }

  if (!signingKey || !timestamp || !token || !signature) {
    return false
  }

  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs)) {
    return false
  }

  const ageMs = Math.abs(Date.now() - timestampMs)
  if (ageMs > 15 * 60 * 1000) {
    return false
  }

  const expected = createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest('hex')

  return safeCompare(expected, signature)
}
