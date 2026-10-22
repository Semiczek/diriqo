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
const VERSION = '99999999-9999-4999-8999-999999999999'
const OPERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DELIVERY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let deliveryState: 'reserved' | 'sent' | 'uncertain' | null
let metadataFailure = false
const reservation = (canSend: boolean) => ({ companyId: COMPANY, quoteId: QUOTE, versionId: VERSION, operationId: OPERATION,
  deliveryId: DELIVERY, canSend, state: deliveryState || 'reserved', attemptToken: canSend ? 's'.repeat(64) : null, shareToken: 'a'.repeat(64) })

function request(overrides: Row = {}) {
  return new NextRequest('https://example.invalid/api/mail/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toEmail: 'synthetic@example.invalid', subject: 'Synthetic offer', text: 'Synthetic message',
      relatedEntityType: 'offer', relatedEntityId: QUOTE, customerId: CUSTOMER, companyId: COMPANY, profileId: PROFILE, versionId: VERSION, operationId: OPERATION, ...overrides }),
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
    then: (resolve: (value: { data: Row[]; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data: operation === 'select' ? [] : [row], error: metadataFailure && operation === 'update' ? { message: 'Metadata failure' } : null }).then(resolve),
  }
  return query
}

beforeEach(() => {
  vi.resetAllMocks()
  trace = []; writes = []; existingThread = null; deliveryState = null; metadataFailure = false
  quote = { id: QUOTE, company_id: COMPANY, customer_id: CUSTOMER }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.authGuard.mockResolvedValue({ ok: true, value: { id: 'synthetic-user' } })
  mocks.roleGuard.mockResolvedValue({ ok: true, value: { companyId: COMPANY, profileId: PROFILE, companyName: 'Synthetic company', role: 'company_admin' } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null })
  mocks.rpc.mockImplementation(async () => { trace.push('reserve'); const canSend = deliveryState === null; if (canSend) deliveryState = 'reserved'; return { data: reservation(canSend), error: null } })
  mocks.userClient.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } })
  mocks.admin.mockReturnValue({ from: databaseQuery, rpc: async (_name: string, args: Row) => { trace.push('complete:' + args.p_state); deliveryState = args.p_state as typeof deliveryState; return { data: { state: deliveryState }, error: null } } })
  mocks.provider.mockImplementation(async () => { trace.push('provider'); return { id: 'synthetic-provider-id' } })
})
afterEach(() => vi.restoreAllMocks())

function expectNoOutboundSideEffects() { expect(mocks.provider).not.toHaveBeenCalled(); expect(writes).toEqual([]) }
describe('version-bound, once-claimed offer delivery', () => {
  it('reserves explicit version before writes and commits provider confirmation before metadata', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, deliveryState: 'sent', quoteId: QUOTE, versionId: VERSION, operationId: OPERATION })
    expect(mocks.rpc).toHaveBeenCalledWith('begin_core_quote_delivery_atomic', expect.objectContaining({ p_company_id: COMPANY, p_quote_id: QUOTE, p_version_id: VERSION, p_operation_id: OPERATION }))
    expect(trace.indexOf('reserve')).toBeLessThan(trace.indexOf('insert:mail_threads'))
    expect(trace.indexOf('insert:mail_messages')).toBeLessThan(trace.indexOf('provider'))
    expect(trace.indexOf('complete:sent')).toBeLessThan(trace.indexOf('update:mail_messages'))
    expect(mocks.provider).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: expect.stringContaining('https://app.diriqo.com/offer/' + 'a'.repeat(64)) }))
  })
  it.each(['versionId','operationId','companyId','profileId'] as const)('does not publish implicitly when %s is absent', async field => {
    expect((await POST(request({ [field]: undefined }))).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled(); expectNoOutboundSideEffects()
  })
  it('rejects a stale active-company scope before claiming or sending', async () => {
    expect((await POST(request({ companyId: OTHER_COMPANY }))).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled(); expectNoOutboundSideEffects()
  })
  it('replays a confirmed receipt without a second thread, message or provider request', async () => {
    expect((await POST(request())).status).toBe(200)
    const count = writes.length
    const again = await POST(request())
    expect(again.status).toBe(200); expect(await again.json()).toMatchObject({ ok: true, deliveryState: 'sent' })
    expect(writes).toHaveLength(count); expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it('rejects an old tab after login as another profile in the same company', async () => {
    mocks.roleGuard.mockResolvedValue({ ok: true, value: { companyId: COMPANY, profileId: OTHER_COMPANY, companyName: 'Synthetic company', role: 'company_admin' } })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled(); expectNoOutboundSideEffects()
  })
  it('a second concurrent request sees the reservation and never sends again', async () => {
    let finish!: (value: { id: string }) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    mocks.provider.mockImplementation(() => { entered(); return new Promise(resolve => { finish = resolve }) })
    const first = POST(request()); await started
    const second = await POST(request())
    expect(second.status).toBe(202); expect(await second.json()).toMatchObject({ ok: false, deliveryState: 'reserved', retryable: false })
    finish({ id: 'provider-accepted' }); expect((await first).status).toBe(200)
    expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it('an uncertain provider result is retained, and retry never invokes provider again', async () => {
    mocks.provider.mockRejectedValue(new Error('Connection lost after dispatch'))
    const first = await POST(request())
    expect(first.status).toBe(202); expect(await first.json()).toMatchObject({ ok: false, deliveryState: 'uncertain', retryable: false })
    expect((await POST(request())).status).toBe(202)
    expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it('metadata failure after confirmed delivery does not claim that sending failed', async () => {
    metadataFailure = true
    const response = await POST(request())
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, deliveryState: 'sent' })
    expect((await POST(request())).status).toBe(200); expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it('existing quote threads still require and reserve their own version', async () => {
    existingThread = { id: THREAD, company_id: COMPANY, customer_id: CUSTOMER, job_id: null, offer_id: QUOTE, subject: 'Existing', thread_key: 't_synthetic123' }
    expect((await POST(request({ threadId: THREAD, relatedEntityId: undefined, relatedEntityType: undefined }))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('begin_core_quote_delivery_atomic', expect.objectContaining({ p_quote_id: QUOTE, p_input: expect.objectContaining({ thread_id: THREAD }) }))
    expect(writes.filter(write => write.table === 'mail_threads' && write.operation === 'insert')).toEqual([])
  })
  it.each(['database-error','network-error','missing-result','wrong-version'] as const)('stops before any send for reservation %s', async failure => {
    if (failure === 'database-error') mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Denied' } })
    if (failure === 'network-error') mocks.rpc.mockRejectedValue(new Error('Transport lost'))
    if (failure === 'missing-result') mocks.rpc.mockResolvedValue({ data: null, error: null })
    if (failure === 'wrong-version') mocks.rpc.mockResolvedValue({ data: { ...reservation(true), versionId: QUOTE }, error: null })
    expect((await POST(request())).status).toBeGreaterThanOrEqual(400); expectNoOutboundSideEffects()
  })
  it.each(['job','customer'] as const)('leaves ordinary %s mail independent of quote publication', async type => {
    expect((await POST(request({ relatedEntityType: type, relatedEntityId: type === 'job' ? JOB : CUSTOMER }))).status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.provider).toHaveBeenCalledOnce()
  })
  it.each(['quote','thread'] as const)('rejects a foreign-company %s before any send', async source => {
    if (source === 'quote') quote = { id: QUOTE, company_id: OTHER_COMPANY, customer_id: CUSTOMER }
    else existingThread = { id: THREAD, company_id: OTHER_COMPANY, offer_id: QUOTE }
    expect((await POST(request(source === 'thread' ? { threadId: THREAD } : {}))).status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled(); expectNoOutboundSideEffects()
  })
  it.each(['auth','role'] as const)('rejects missing %s before privileged access', async guard => {
    const denied = { ok: false, error: 'Denied', status: guard === 'auth' ? 401 : 403 }
    if (guard === 'auth') mocks.authGuard.mockResolvedValue(denied); else mocks.roleGuard.mockResolvedValue(denied)
    expect((await POST(request())).status).toBe(denied.status)
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expectNoOutboundSideEffects()
  })
})
