import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const WORKER_INVITE_TOKEN_BYTES = 32

export function generateInviteToken() {
  return randomBytes(WORKER_INVITE_TOKEN_BYTES).toString('base64url')
}

export function hashInviteToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function verifyInviteTokenHash(token: string, tokenHash: string) {
  const computed = Buffer.from(hashInviteToken(token), 'hex')
  const expected = Buffer.from(tokenHash, 'hex')

  if (computed.length !== expected.length) {
    return false
  }

  return timingSafeEqual(computed, expected)
}

export function getWorkerInviteExpiry(now = new Date()) {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
}

export function isInviteExpired(expiresAt: string | Date, now = new Date()) {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()
}
