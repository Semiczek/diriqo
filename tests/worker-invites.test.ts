import { describe, expect, it } from 'vitest'

import {
  getWorkerInviteExpiry,
  hashInviteToken,
  isInviteExpired,
  verifyInviteTokenHash,
} from '../lib/invites/token'
import {
  buildInviteMessage,
  buildWhatsAppInviteUrl,
  normalizePhoneForStorage,
  normalizePhoneForWhatsApp,
} from '../lib/invites/whatsapp'
import { evaluateInviteRow, maskInvitePhone } from '../lib/invites/worker-invites'

const baseInvite = {
  id: 'invite-id',
  company_id: 'company-id',
  worker_profile_id: 'profile-id',
  phone: '+420 777 123 456',
  token_hash: hashInviteToken('token'),
  status: 'pending' as const,
  expires_at: getWorkerInviteExpiry(new Date('2026-05-13T10:00:00.000Z')).toISOString(),
  used_at: null,
  revoked_at: null,
  created_by: 'creator-id',
  created_at: '2026-05-13T10:00:00.000Z',
  updated_at: '2026-05-13T10:00:00.000Z',
  profiles: {
    id: 'profile-id',
    full_name: 'Jan Worker',
    phone: '+420 777 123 456',
  },
  companies: {
    id: 'company-id',
    name: 'Diriqo Demo',
  },
}

describe('worker invite helpers', () => {
  it('normalizes phone numbers for WhatsApp and storage', () => {
    expect(normalizePhoneForWhatsApp('+420 777 123 456')).toBe('420777123456')
    expect(normalizePhoneForWhatsApp('(420) 777-123-456')).toBe('420777123456')
    expect(normalizePhoneForStorage('+420 777 123 456')).toBe('+420777123456')
    expect(normalizePhoneForStorage('420 777 123 456')).toBe('420777123456')
  })

  it('builds localized invite messages and wa.me URLs', () => {
    const inviteLink = 'https://app.diriqo.com/invite/abc'
    const csMessage = buildInviteMessage({ inviteLink, locale: 'cs' })
    const enMessage = buildInviteMessage({ inviteLink, locale: 'en' })

    expect(csMessage).toContain('Ahoj')
    expect(csMessage).toContain(inviteLink)
    expect(enMessage).toContain("you've been invited")

    const url = buildWhatsAppInviteUrl('+420 777 123 456', csMessage)
    expect(url).toContain('https://wa.me/420777123456?text=')
    expect(decodeURIComponent(url)).toContain(inviteLink)
  })

  it('hashes and verifies raw invite tokens without storing them', () => {
    const tokenHash = hashInviteToken('raw-token')

    expect(tokenHash).toHaveLength(64)
    expect(verifyInviteTokenHash('raw-token', tokenHash)).toBe(true)
    expect(verifyInviteTokenHash('wrong-token', tokenHash)).toBe(false)
  })

  it('detects expired invites', () => {
    expect(isInviteExpired('2026-05-13T09:00:00.000Z', new Date('2026-05-13T10:00:00.000Z'))).toBe(true)
    expect(isInviteExpired('2026-05-13T11:00:00.000Z', new Date('2026-05-13T10:00:00.000Z'))).toBe(false)
  })

  it('evaluates pending, expired, revoked and used states safely', () => {
    const now = new Date('2026-05-13T10:00:00.000Z')

    expect(evaluateInviteRow(baseInvite, now)).toMatchObject({
      ok: true,
      companyName: 'Diriqo Demo',
      workerName: 'Jan Worker',
      phoneMasked: maskInvitePhone('+420 777 123 456'),
    })

    expect(evaluateInviteRow({ ...baseInvite, expires_at: '2026-05-13T09:00:00.000Z' }, now)).toEqual({
      ok: false,
      status: 'expired',
    })
    expect(evaluateInviteRow({ ...baseInvite, status: 'revoked' }, now)).toEqual({ ok: false, status: 'revoked' })
    expect(evaluateInviteRow({ ...baseInvite, status: 'used' }, now)).toEqual({ ok: false, status: 'used' })
  })
})
