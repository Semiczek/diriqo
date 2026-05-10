import 'server-only'

import { randomBytes } from 'crypto'

export function getMailgunFromDomain() {
  return process.env.MAILGUN_FROM_DOMAIN?.trim() || process.env.MAILGUN_DOMAIN?.trim() || 'mg.diriqo.com'
}

export function slugifyMailboxLocalPart(value: string | null | undefined) {
  const normalized = (value ?? 'diriqo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return normalized || 'diriqo'
}

export function buildCompanySender(input: { companyName: string | null }) {
  const domain = getMailgunFromDomain()
  const localPart = slugifyMailboxLocalPart(input.companyName)
  const name = input.companyName?.trim() || 'Diriqo'
  const email = `${localPart}@${domain}`.toLowerCase()

  return {
    name,
    email,
    formatted: `${name} <${email}>`,
  }
}

export function createThreadKey() {
  const token = randomBytes(8)
    .toString('base64url')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 12)

  return `t_${token}`
}

export function buildThreadReplyToAddress(threadKey: string) {
  return `${threadKey}@${getMailgunFromDomain()}`.toLowerCase()
}

export function extractThreadKeyFromAddress(value: string | null | undefined) {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return null

  const angleMatch = raw.match(/<([^>]+)>/)
  const email = (angleMatch?.[1] ?? raw).split(',')[0]?.trim() ?? ''
  const localPart = email.split('@')[0]?.trim() ?? ''

  return /^t_[a-z0-9-]{8,64}$/.test(localPart) ? localPart : null
}
