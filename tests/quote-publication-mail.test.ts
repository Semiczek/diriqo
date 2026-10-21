import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authGuard: vi.fn(), roleGuard: vi.fn(), admin: vi.fn(), userClient: vi.fn(),
  getUser: vi.fn(), rpc: vi.fn(), provider: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireAuthenticatedUser: mocks.authGuard, requireCompanyRole: mocks.roleGuard }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.userClient }))
vi.mock('@/lib/mail/mailgun', () => ({ sendMailgunMessage: mocks.provider }))

// Exercise the real POST and publication DAL. Only Auth, databases and Mailgun are mocked.
// These prove application ordering and failures, not hosted snapshot isolation or email delivery.
import { POST } from '../app/api/mail/send/route'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222'
const QUOTE = '33333333-3333-4333-8333-333333333333'
const CUSTOMER = '44444444-4444-4444-8444-444444444444'
const JOB = '55555555-5555-4555-8555-555555555555'
const THREAD = '66666666-6666-4666-8666-666666666666'
const MESSAGE = '77777777-7777-4777-8777-777777777777'
const PROFILE = '88888888-8888-4888-8888-888888888888'
type Row = Record<string, unknown>
type Write = { table: string; operation: string; row: Row }
let trace: string[]
let writes: Write[]
let existingThread: Row | null
let quote: Row | null
const publication = () => ({ quoteId: QUOTE, shareToken: 'a'.repeat(48), state: 'captured', capturedAt: '2026-10-21T08:00:00.000Z' })

function request(overrides: Row = {}) {
  return new NextRequest('https://example.invalid/api/mail/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toEmail: 'synthetic@example.invalid', subject: 'Synthetic offer', text: 'Synthetic message',
      relatedEntityType: 'offer', relatedEntityId: QUOTE, customerId: CUSTOMER, ...overrides }),
  })
}

function databaseQuery(table: string) {
  const filters = new Map<string, unknown>()
  let operation = 'select'
  let row: Row = {}
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.set(key, value); return query },
    order: () => query,
    limit: () => query,
    insert: (value: Row) => { operation = 'insert'; row = value; writes.push({ table, operation, row: value }); trace.push(`insert:${table}`); return query },
    update: (value: Row) => { operation = 'update'; row = value; writes.push({ table, operation, row: value }); trace.push(`update:${table}`); return query },
    maybeSingle: async () => {
      trace.push(`read:${table}`)
      const data: Row | null = table === 'mail_threads' ? existingThread : table === 'quotes' ? quote
        : table === 'jobs' ? { id: JOB, company_id: COMPANY, customer_id: CUSTOMER }
        : table === 'customers' ? { id: CUSTOMER, company_id: COMPANY } : null
      const visible = data && [...filters].every(([key, value]) => data[key] === value)
      return { data: visible ? data : null, error: null }
    },
    single: async () => ({ data: table === 'mail_threads'
      ? { ...row, id: THREAD, thread_key: 't_synthetic123' } : { id: MESSAGE }, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: operation === 'select' ? [] : [row], error: null }).then(resolve),
  }
  return query
}

beforeEach(() => {
  vi.resetAllMocks()
  trace = []; writes = []; existingThread = null
  quote = { id: QUOTE, company_id: COMPANY, customer_id: CUSTOMER }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.authGuard.mockResolvedValue({ ok: true, value: { id: 'synthetic-user' } })
  mocks.roleGuard.mockResolvedValue({ ok: true, value: { companyId: COMPANY, profileId: PROFILE, companyName: 'Synthetic company', role: 'company_admin' } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null })
  mocks.rpc.mockImplementation(async () => { trace.push('publish'); return { data: publication(), error: null } })
  mocks.userClient.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } })
  mocks.admin.mockReturnValue({ from: databaseQuery })
  mocks.provider.mockImplementation(async () => { trace.push('provider'); return { id: 'synthetic-provider-id' } })
})
afterEach(() => vi.restoreAllMocks())

function expectPublication() {
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('publish_core_quote_customer_identity', {
    p_company_id: COMPANY, p_quote_id: QUOTE,
  })
  expect(mocks.userClient).toHaveBeenCalledOnce()
}
function expectNoOutboundSideEffects() {
  expect(mocks.provider).not.toHaveBeenCalled()
  expect(writes).toEqual([])
}

describe('quote publication before outbound mail', () => {
  it('publishes the resolved offer through the user client before creating a thread, message or provider request', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expectPublication()
    expect(trace.indexOf('read:quotes')).toBeLessThan(trace.indexOf('publish'))
    expect(trace.indexOf('publish')).toBeLessThan(trace.indexOf('insert:mail_threads'))
    expect(trace.indexOf('insert:mail_threads')).toBeLessThan(trace.indexOf('insert:mail_messages'))
    expect(trace.indexOf('insert:mail_messages')).toBeLessThan(trace.indexOf('provider'))
    expect(mocks.provider).toHaveBeenCalledOnce()
    expect(writes.find(write => write.table === 'mail_threads')?.row).toMatchObject({ company_id: COMPANY, offer_id: QUOTE })
  })

  it('awaits committed publication before starting any outbound side effect', async () => {
    let finish!: (value: unknown) => void
    let entered!: () => void
    const publicationStarted = new Promise<void>(resolve => { entered = resolve })
    mocks.rpc.mockImplementation(() => {
      entered()
      return new Promise(resolve => { finish = resolve })
    })
    const pendingResponse = POST(request())
    await publicationStarted
    expectNoOutboundSideEffects()
    finish({ data: publication(), error: null })
    expect((await pendingResponse).status).toBe(200)
    expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it('preserves a legacy unknown identity without pretending to recapture it', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...publication(), state: 'legacy_unknown', capturedAt: null }, error: null })
    expect((await POST(request())).status).toBe(200)
    expectPublication()
    expect(writes.some(write => write.table === 'quotes' || write.table === 'customers')).toBe(false)
    expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it('does not undo or repeat publication when the provider rejects the send', async () => {
    mocks.provider.mockRejectedValue(new Error('Synthetic provider failure'))
    expect((await POST(request())).status).toBeGreaterThanOrEqual(400)
    expectPublication()
    expect(writes.some(write => write.table === 'quotes' || write.table === 'customers')).toBe(false)
    expect(writes.some(write => write.table === 'mail_events' && write.row.event_type === 'send_failed')).toBe(true)
    expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it('publishes an existing offer thread even when the payload contains no offer ID', async () => {
    existingThread = { id: THREAD, company_id: COMPANY, customer_id: CUSTOMER, job_id: null, offer_id: QUOTE,
      subject: 'Existing offer', thread_key: 't_synthetic123' }
    const response = await POST(request({ relatedEntityType: undefined, relatedEntityId: undefined, customerId: undefined, threadId: THREAD }))
    expect(response.status).toBe(200)
    expectPublication()
    expect(trace.indexOf('read:mail_threads')).toBeLessThan(trace.indexOf('publish'))
    expect(trace.indexOf('publish')).toBeLessThan(trace.indexOf('insert:mail_messages'))
    expect(writes.filter(write => write.table === 'mail_threads' && write.operation === 'insert')).toEqual([])
  })

  it('uses the existing thread offer instead of a conflicting caller-supplied offer ID', async () => {
    existingThread = { id: THREAD, company_id: COMPANY, customer_id: CUSTOMER, job_id: null, offer_id: QUOTE,
      subject: 'Existing offer', thread_key: 't_synthetic123' }
    const response = await POST(request({ threadId: THREAD, relatedEntityId: JOB }))
    // A stricter caller-conflict rejection is also safe, but it must have no outbound effects.
    if (response.status >= 400) { expectNoOutboundSideEffects(); return }
    expect(response.status).toBe(200)
    expectPublication()
  })

  it.each(['database-error', 'network-error', 'missing-result'] as const)('stops before any mail write or send on publication %s', async failure => {
    if (failure === 'database-error') mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'QUOTE_PUBLICATION_FORBIDDEN' } })
    if (failure === 'network-error') mocks.rpc.mockRejectedValue(new Error('Synthetic publication transport failure'))
    if (failure === 'missing-result') mocks.rpc.mockResolvedValue({ data: null, error: null })
    const response = await POST(request())
    expect(response.status).toBeGreaterThanOrEqual(400)
    expectPublication()
    expectNoOutboundSideEffects()
  })

  it('also stops an existing thread reply when publication cannot be prepared', async () => {
    existingThread = { id: THREAD, company_id: COMPANY, customer_id: CUSTOMER, job_id: null, offer_id: QUOTE,
      subject: 'Existing offer', thread_key: 't_synthetic123' }
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'QUOTE_PUBLICATION_FORBIDDEN' } })
    const response = await POST(request({ threadId: THREAD, relatedEntityType: undefined, relatedEntityId: undefined }))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expectPublication()
    expectNoOutboundSideEffects()
  })

  it.each(['job', 'customer'] as const)('does not publish an offer for ordinary %s mail', async type => {
    const response = await POST(request({ relatedEntityType: type, relatedEntityId: type === 'job' ? JOB : CUSTOMER }))
    expect(response.status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.userClient).not.toHaveBeenCalled()
    expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it('does not let a supplied offer ID turn a customer-only thread into quote publication', async () => {
    existingThread = { id: THREAD, company_id: COMPANY, customer_id: CUSTOMER, job_id: null, offer_id: null,
      subject: 'Customer thread', thread_key: 't_synthetic123' }
    const response = await POST(request({ threadId: THREAD }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    if (response.status >= 400) expectNoOutboundSideEffects()
    else expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it.each(['quote', 'thread'] as const)('rejects a foreign-company %s before publication or mail writes', async source => {
    if (source === 'quote') quote = { id: QUOTE, company_id: OTHER_COMPANY, customer_id: CUSTOMER }
    else existingThread = { id: THREAD, company_id: OTHER_COMPANY, offer_id: QUOTE }
    const response = await POST(request(source === 'thread' ? { threadId: THREAD } : {}))
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expectNoOutboundSideEffects()
  })

  it.each(['auth', 'role'] as const)('rejects missing %s authority before privileged DB or provider access', async guard => {
    const denied = { ok: false, error: 'Synthetic access denied', status: guard === 'auth' ? 401 : 403 }
    if (guard === 'auth') mocks.authGuard.mockResolvedValue(denied)
    else mocks.roleGuard.mockResolvedValue(denied)
    expect((await POST(request())).status).toBe(denied.status)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expectNoOutboundSideEffects()
  })
})
