import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), insert: vi.fn(), update: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))

import { verifyMailgunSignature } from '../lib/mail/mailgun-signature'
import { POST as inbound } from '../app/api/mail/inbound/route'
import { POST as events } from '../app/api/mail/events/route'

const SIGNING_KEY = 'synthetic-mailgun-signing-key'
const NOW = 1_790_000_000_000
const COMPANY_ID = 'company-synthetic'
const THREAD_ID = 'thread-synthetic'
const MESSAGE_ID = 'message-synthetic'
type Signature = { timestamp: string; token: string; signature: string }
type SignatureFormat = 'flat' | 'bracket' | 'nested'
type Encoding = 'json' | 'form'

function signed(timestamp = String(NOW / 1000)): Signature {
  const token = 'synthetic-request-token'
  return {
    timestamp,
    token,
    signature: createHmac('sha256', SIGNING_KEY).update(`${timestamp}${token}`).digest('hex'),
  }
}

function request(
  signature: Partial<Signature> = {},
  format: SignatureFormat = 'flat',
  encoding: Encoding = 'json',
) {
  const payload: Record<string, unknown> = {
    recipient: 't_synthetic123@mg.example.invalid',
    from: 'Synthetic Sender <sender@example.invalid>',
    subject: 'Synthetic inbound message',
    'body-plain': 'Synthetic body',
    event: 'delivered',
    'message-id': 'synthetic-provider-message-id',
  }
  if (format === 'nested') payload.signature = signature
  else {
    for (const [key, value] of Object.entries(signature)) {
      payload[format === 'bracket' ? `signature[${key}]` : key] = value
    }
  }
  return new NextRequest('https://example.invalid/api/mail/webhook', {
    method: 'POST',
    headers: { 'content-type': encoding === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: encoding === 'json'
      ? JSON.stringify(payload)
      : new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])),
  })
}

function expectNoPrivilegedAccess() {
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.stubEnv('MAILGUN_WEBHOOK_SIGNING_KEY', SIGNING_KEY)
  mocks.admin.mockReturnValue({
    from: (table: string) => {
      const filters = new Map<string, unknown>()
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.set(key, value); return query },
        maybeSingle: async () => ({
          data: table === 'mail_threads'
            ? { id: THREAD_ID, company_id: COMPANY_ID, subject: 'Thread subject', thread_key: 't_synthetic123',
              customer_id: null, job_id: null, offer_id: null }
            : filters.has('direction') ? null : { id: MESSAGE_ID, company_id: COMPANY_ID },
          error: null,
        }),
        insert: (row: unknown) => { mocks.insert(table, row); return query },
        update: (row: unknown) => { mocks.update(table, row); return query },
        single: async () => ({ data: { id: MESSAGE_ID }, error: null }),
        then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
      }
      return query
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Mailgun signature boundary', () => {
  it.each([undefined, '', '   '])('rejects unsigned input without a configured key (%s)', (key) => {
    vi.stubEnv('MAILGUN_WEBHOOK_SIGNING_KEY', key)
    expect(verifyMailgunSignature({ timestamp: null, token: null, signature: null })).toBe(false)
  })

  it('accepts a current valid HMAC, including surrounding whitespace', () => {
    const input = signed()
    expect(verifyMailgunSignature(input)).toBe(true)
    vi.stubEnv('MAILGUN_WEBHOOK_SIGNING_KEY', ` ${SIGNING_KEY} `)
    expect(verifyMailgunSignature({
      timestamp: ` ${input.timestamp} `, token: ` ${input.token} `, signature: ` ${input.signature} `,
    })).toBe(true)
  })

  it.each(['timestamp', 'token', 'signature'] as const)('rejects a missing %s', (field) => {
    expect(verifyMailgunSignature({ ...signed(), [field]: null })).toBe(false)
  })

  it.each([
    ['changed token', () => ({ ...signed(), token: 'attacker-token' })],
    ['invalid digest', () => ({ ...signed(), signature: '0'.repeat(64) })],
    ['different length', () => ({ ...signed(), signature: 'invalid' })],
    ['invalid timestamp', () => signed('not-a-number')],
    ['expired timestamp', () => signed(String(NOW / 1000 - 901))],
    ['future timestamp', () => signed(String(NOW / 1000 + 901))],
  ] as const)('rejects %s', (_name, input) => {
    expect(verifyMailgunSignature(input())).toBe(false)
  })

  it.each([-900, 900])('preserves the inclusive 15 minute validity window (%s seconds)', (offset) => {
    expect(verifyMailgunSignature(signed(String(NOW / 1000 + offset)))).toBe(true)
  })
})

describe.each([{ name: 'inbound', handler: inbound }, { name: 'events', handler: events }])(
  'Mailgun $name endpoint', ({ name, handler }) => {
    it.each([undefined, '', '   '])('returns 503 without configuration (%s), before parsing or privileged work', async (key) => {
      vi.stubEnv('MAILGUN_WEBHOOK_SIGNING_KEY', key)
      const input = request()
      const parse = vi.spyOn(input, 'json')
      const response = await handler(input)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ ok: false, error: 'Mailgun webhook is not configured.' })
      expect(parse).not.toHaveBeenCalled()
      expectNoPrivilegedAccess()
    })

    it('does not accept signed-looking form data without configuration', async () => {
      vi.stubEnv('MAILGUN_WEBHOOK_SIGNING_KEY', undefined)
      const input = request(signed(), 'bracket', 'form')
      const parse = vi.spyOn(input, 'formData')
      const response = await handler(input)
      expect(response.status).toBe(503)
      expect(parse).not.toHaveBeenCalled()
      expectNoPrivilegedAccess()
    })

    it.each([
      ['unsigned', () => ({})],
      ['missing timestamp', () => ({ token: signed().token, signature: signed().signature })],
      ['missing token', () => ({ timestamp: signed().timestamp, signature: signed().signature })],
      ['missing signature', () => ({ timestamp: signed().timestamp, token: signed().token })],
      ['invalid signature', () => ({ ...signed(), signature: '0'.repeat(64) })],
      ['expired signature', () => signed(String(NOW / 1000 - 901))],
      ['future signature', () => signed(String(NOW / 1000 + 901))],
    ] as const)('returns 401 for %s with no privileged work', async (_name, signature) => {
      const response = await handler(request(signature()))
      expect(response.status).toBe(401)
      expectNoPrivilegedAccess()
    })

    it('rejects an invalid bracket-form signature with no privileged work', async () => {
      const response = await handler(request({ ...signed(), signature: 'invalid' }, 'bracket', 'form'))
      expect(response.status).toBe(401)
      expectNoPrivilegedAccess()
    })

    it.each([
      ['flat', 'json'], ['bracket', 'json'], ['flat', 'form'], ['bracket', 'form'],
    ] as const)('preserves legitimate %s signatures in %s requests', async (format, encoding) => {
      const response = await handler(request(signed(), format, encoding))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, matched: true })
      expect(mocks.insert).toHaveBeenCalledWith('mail_events', expect.objectContaining({
        company_id: COMPANY_ID, message_id: MESSAGE_ID, provider: 'mailgun',
        event_type: name === 'inbound' ? 'inbound_received' : 'delivered',
      }))
      if (name === 'inbound') {
        expect(mocks.insert).toHaveBeenCalledWith('mail_messages', expect.objectContaining({
          company_id: COMPANY_ID, thread_id: THREAD_ID, direction: 'inbound',
          from_email: 'sender@example.invalid', body_text: 'Synthetic body',
        }))
        expect(mocks.update).toHaveBeenCalledOnce()
      } else {
        expect(mocks.insert).toHaveBeenCalledOnce()
        expect(mocks.update).not.toHaveBeenCalled()
      }
    })
  },
)

it('preserves nested JSON signatures used by Mailgun event webhooks', async () => {
  const response = await events(request(signed(), 'nested'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, matched: true })
  expect(mocks.insert).toHaveBeenCalledWith('mail_events', expect.objectContaining({
    company_id: COMPANY_ID, message_id: MESSAGE_ID, event_type: 'delivered',
  }))
})
