import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), company: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn(), rethrow: vi.fn(), email: vi.fn(), pdf: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: mocks.rethrow }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }) }))
vi.mock('@/lib/email/sendTransactionalEmail', () => ({ sendTransactionalEmail: mocks.email }))
vi.mock('@/lib/invoice-pdf-safe', () => ({ buildInvoicePdf: mocks.pdf }))

import { cancelInvoiceAtomic, markInvoicePaidAtomic, invoiceSettlementError } from '../lib/dal/invoice-settlement'
import type { InvoiceIssueContext } from '../lib/dal/invoices'
import { cancelInvoiceAction, markInvoicePaidAction, markInvoiceSent, sendInvoiceByEmail } from '../app/invoices/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const invoiceId = 'b1111111-1111-4111-8111-111111111111'
const jobId = 'c1111111-1111-4111-8111-111111111111'
const secondJobId = 'd1111111-1111-4111-8111-111111111111'
const revision = 'a'.repeat(64)
const settledAt = '2026-10-13T17:00:01.123456Z'
const initial = { error: null, reloadRequired: false }
const input = { invoiceId, expectedRevision: revision }
const context = () => ({ companyId, supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc } }) as unknown as InvoiceIssueContext
const result = (status: 'paid' | 'cancelled' = 'paid', changed = true) => ({
  invoice_id: invoiceId, status, changed, [status === 'paid' ? 'paid_at' : 'cancelled_at']: settledAt,
  job_ids: changed ? [jobId, secondJobId] : [],
})
const operations = [
  { status: 'paid' as const, rpc: 'mark_invoice_paid_atomic', dal: markInvoicePaidAtomic, action: markInvoicePaidAction },
  { status: 'cancelled' as const, rpc: 'cancel_invoice_atomic', dal: cancelInvoiceAtomic, action: cancelInvoiceAction },
]
function form() {
  const data = new FormData()
  data.set('companyId', companyId)
  data.set('invoiceId', invoiceId)
  data.set('revision', revision)
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.company.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('Settlement must not split the transaction into table calls') })
})

describe.each(operations)('$status settlement boundary', ({ status, rpc, dal, action }) => {
  it('uses one authenticated, company-scoped RPC with a revision and no client timestamps or job authority', async () => {
    mocks.rpc.mockResolvedValue({ data: result(status), error: null })
    const data = form()
    data.set('paid_at', '2000-01-01')
    data.set('cancelled_at', '2000-01-02')
    data.set('status', 'draft')
    data.set('jobIds', 'forged-job')
    data.set('entitlementId', 'forged-entitlement')
    expect(await action(initial, data)).toEqual(initial)
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(rpc, {
      target_company_id: companyId, target_invoice_id: invoiceId, expected_revision: revision,
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.revalidate.mock.calls).toEqual([
      ['/invoices'], [`/invoices/${invoiceId}`], ['/jobs'], [`/jobs/${jobId}`], [`/jobs/${secondJobId}`],
    ])
  })

  it('accepts a confirmed idempotent result without generating a new timestamp or repeating side effects', async () => {
    mocks.rpc.mockResolvedValue({ data: result(status, false), error: null })
    expect(await dal(context(), input)).toEqual({ invoiceId, status, changed: false, settledAt, jobIds: [] })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('refreshes only invoice and job overview for a confirmed no-op with no affected jobs', async () => {
    mocks.rpc.mockResolvedValue({ data: result(status, false), error: null })
    expect(await action(initial, form())).toEqual(initial)
    expect(mocks.revalidate.mock.calls).toEqual([['/invoices'], [`/invoices/${invoiceId}`], ['/jobs']])
  })

  it('normalizes UUID case without changing the opaque revision', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(status), job_ids: [jobId.toUpperCase()] }, error: null })
    expect(await dal({ ...context(), companyId: companyId.toUpperCase() }, { ...input, invoiceId: invoiceId.toUpperCase() }))
      .toMatchObject({ invoiceId, jobIds: [jobId] })
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, { target_company_id: companyId, target_invoice_id: invoiceId, expected_revision: revision })
  })

  it.each(['', secondJobId])('rejects a missing or switched hidden company (%s) before writing', async hiddenCompany => {
    const data = form(); data.set('companyId', hiddenCompany)
    expect(await action(initial, data)).toMatchObject({ error: expect.stringContaining('Aktivní firma se změnila'), reloadRequired: true })
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('preserves framework authorization redirects before calling Auth or the RPC', async () => {
    const redirect = new Error('NEXT_REDIRECT')
    mocks.company.mockRejectedValue(redirect)
    mocks.rethrow.mockImplementation(error => { if (error === redirect) throw error })
    await expect(action(initial, form())).rejects.toBe(redirect)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'invalid-token-user' } }, error: { message: 'PRIVATE token error' } },
  ])('requires verified Auth (%j)', async auth => {
    mocks.auth.mockResolvedValue(auth)
    await expect(dal(context(), input)).rejects.toThrow('nemáte oprávnění')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['INVOICE_SETTLEMENT_STALE', 'mezitím někdo změnil'],
    ['INVOICE_SETTLEMENT_FORBIDDEN', 'nemáte oprávnění'],
    ['INVOICE_SETTLEMENT_INPUT_INVALID', 'není platný'],
    ['INVOICE_NOT_FOUND', 'aktivní firmě nalezena'],
    ['INVOICE_INVALID_STATE', 'tomto stavu'],
    ['INVOICE_CANCEL_PAID', 'Zaplacenou fakturu'],
    ['INVOICE_CANCEL_EXPORTED', 'Exportovanou fakturu'],
    ['INVOICE_LINK_SCOPE_INVALID', 'souvisejících zakázek'],
    ['INVOICE_LINK_CONFLICT', 'souvisejících zakázek'],
    ['INVOICE_SETTLEMENT_JOB_CONFLICT', 'souvisejících zakázek'],
  ])('returns safe %s without revalidation, child writes or retry', async (message, safeText) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message, details: 'PRIVATE customer', hint: 'PRIVATE connection' } })
    const response = await action(initial, form())
    expect(response).toEqual({ error: expect.stringContaining(safeText), reloadRequired: true })
    expect(response.error).not.toContain('PRIVATE')
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('does not retry an uncertain COMMIT or discard the form through revalidation', async () => {
    mocks.rpc.mockRejectedValue(new Error('PRIVATE lost connection after COMMIT'))
    expect(await action(initial, form())).toEqual({ error: invoiceSettlementError(null).message, reloadRequired: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe('settlement response and input validation', () => {
  it.each(['', 'not-a-uuid', `${invoiceId}/../../other`])('rejects malformed invoice identity %j without Auth or writes', async invoiceId => {
    await expect(markInvoicePaidAtomic(context(), { ...input, invoiceId })).rejects.toThrow('aktivní firmě')
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a malformed company', async () => {
    await expect(markInvoicePaidAtomic({ ...context(), companyId: '' }, input)).rejects.toThrow('aktivní firmě')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['', 'updated_at', 'a'.repeat(63), 'A'.repeat(64)])('rejects invalid revision %j instead of guessing', async expectedRevision => {
    await expect(markInvoicePaidAtomic(context(), { ...input, expectedRevision })).rejects.toThrow('není platný')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    null, {}, [], { ...result(), invoice_id: companyId }, { ...result(), status: 'cancelled' },
    { ...result(), changed: 'true' }, { ...result(), paid_at: null }, { ...result(), paid_at: 'invalid date' },
    { ...result(), job_ids: null }, { ...result(), job_ids: ['../private'] },
    { ...result(), job_ids: [jobId, jobId.toUpperCase()] }, { ...result(), job_ids: [null] },
  ])('treats malformed successful RPC payload as unknown outcome %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await markInvoicePaidAction(initial, form())).toEqual({ error: invoiceSettlementError(null).message, reloadRequired: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('requires the cancellation timestamp instead of accepting a paid response in disguise', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), status: 'cancelled' }, error: null })
    expect(await cancelInvoiceAction(initial, form())).toEqual({ error: invoiceSettlementError(null).message, reloadRequired: true })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not expose unknown provider messages, even if they contain a known token', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE INVOICE_CANCEL_PAID', details: 'PRIVATE' } })
    await expect(markInvoicePaidAtomic(context(), input)).rejects.toThrow(invoiceSettlementError(null).message)
  })
  it('does not write after an unexpected Auth transport failure', async () => {
    mocks.auth.mockRejectedValue(new Error('PRIVATE auth failure'))
    expect(await markInvoicePaidAction(initial, form())).toEqual({ error: invoiceSettlementError(null).message, reloadRequired: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

// Mutable row model exercises the predicates against a status changed between read and write.
// Email transport and PDF generation remain mocked; no real mail or database calls occur.
function sentStatusModel(
  beforeWrite?: (row: Record<string, unknown>, write: number) => void,
  beforeRead?: (row: Record<string, unknown>, read: number) => void,
) {
  const row: Record<string, unknown> = {
    id: invoiceId, company_id: companyId, customer_id: secondJobId, status: 'issued', invoice_number: '2026-1',
    customer_snapshot: { email: 'fixture@example.invalid' }, supplier_snapshot: { name: 'Fixture' }, paid_at: null,
  }
  const writes: { payload: Record<string, unknown>; matches: boolean }[] = []
  let reads = 0
  mocks.from.mockImplementation((table: string) => {
    let payload: Record<string, unknown> | null = null
    const predicates: ((row: Record<string, unknown>) => boolean)[] = []
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: Record<string, unknown>) => { payload = value; return query }),
      eq: vi.fn((key: string, value: unknown) => { predicates.push(row => row[key] === value); return query }),
      in: vi.fn((key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query }),
      order: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        if (payload) beforeWrite?.(row, writes.length)
        else beforeRead?.(row, reads++)
        const matches = predicates.every(predicate => predicate(row))
        if (payload) {
          writes.push({ payload, matches })
          if (matches) Object.assign(row, payload)
        }
        return { data: matches ? { ...row } : null, error: null }
      }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: table === 'invoice_items' ? [] : [{ ...row }], error: null }),
    }
    return query
  })
  return { row, writes }
}

describe('sent status cannot reverse settlement', () => {
  it.each(['paid', 'cancelled'])('manual sent action detects %s winning after the read', async status => {
    const { row, writes } = sentStatusModel(row => { row.status = status; row.paid_at = settledAt })
    await expect(markInvoiceSent(form())).rejects.toThrow('Stav faktury se změnil')
    expect(row.status).toBe(status)
    expect(row.paid_at).toBe(settledAt)
    expect(writes).toHaveLength(1)
    expect(writes[0].matches).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('manual sent action still updates an issued invoice in the active company', async () => {
    const { row } = sentStatusModel()
    await markInvoiceSent(form())
    expect(row.status).toBe('sent')
    expect(mocks.revalidate.mock.calls).toEqual([['/invoices'], [`/invoices/${invoiceId}`]])
  })
  it('post-email bookkeeping preserves a payment that happened while the mocked email was sent', async () => {
    const { row, writes } = sentStatusModel()
    mocks.email.mockImplementation(async () => { row.status = 'paid'; row.paid_at = settledAt })
    await sendInvoiceByEmail(form())
    expect(mocks.email).toHaveBeenCalledOnce()
    expect(row.status).toBe('paid')
    expect(row.paid_at).toBe(settledAt)
    expect(row.sent_at).toEqual(expect.any(String))
    expect(writes.map(write => write.matches)).toEqual([false, true])
    expect(writes[1].payload).not.toHaveProperty('status')
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/invoices/${invoiceId}?mail=sent`)
  })
  it('post-email bookkeeping never resurrects a concurrently cancelled invoice or resends mail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { row, writes } = sentStatusModel()
      mocks.email.mockImplementation(async () => { row.status = 'cancelled' })
      await sendInvoiceByEmail(form())
      expect(row.status).toBe('cancelled')
      expect(row.sent_at).toBeUndefined()
      expect(writes.map(write => write.matches)).toEqual([false, false])
      expect(mocks.email).toHaveBeenCalledOnce()
      expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain('E-mail byl odeslán')
      expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain('znovu neodesílejte')
      expect(mocks.revalidate).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
  it('issued email still records sent in one conditional update', async () => {
    const { row, writes } = sentStatusModel()
    await sendInvoiceByEmail(form())
    expect(row.status).toBe('sent')
    expect(writes).toHaveLength(1)
    expect(mocks.email).toHaveBeenCalledOnce()
  })
  it('rechecks eligibility on the fresh email snapshot before calling the transport', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { row, writes } = sentStatusModel(undefined, (row, read) => { if (read === 1) row.status = 'cancelled' })
      await sendInvoiceByEmail(form())
      expect(row.status).toBe('cancelled')
      expect(writes).toEqual([])
      expect(mocks.email).not.toHaveBeenCalled()
      expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain('Načtěte její aktuální stav')
    } finally { log.mockRestore() }
  })
  it('rechecks current status again when cancellation wins before the email timestamp fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { row, writes } = sentStatusModel((row, write) => { if (write === 1) row.status = 'cancelled' })
      mocks.email.mockImplementation(async () => { row.status = 'sent' })
      await sendInvoiceByEmail(form())
      expect(row.status).toBe('cancelled')
      expect(row.sent_at).toBeUndefined()
      expect(writes.map(write => write.matches)).toEqual([false, false])
      expect(mocks.email).toHaveBeenCalledOnce()
      expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain('E-mail byl odeslán')
    } finally { log.mockRestore() }
  })
  it('reports already sent after a bookkeeping transport failure and does not repeat the email', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      sentStatusModel(() => { throw new Error('PRIVATE transport response lost') })
      await sendInvoiceByEmail(form())
      expect(mocks.email).toHaveBeenCalledOnce()
      const message = decodeURIComponent(mocks.redirect.mock.calls[0][0])
      expect(message).toContain('E-mail byl odeslán')
      expect(message).toContain('znovu neodesílejte')
      expect(message).not.toContain('PRIVATE')
      expect(mocks.revalidate).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
})
