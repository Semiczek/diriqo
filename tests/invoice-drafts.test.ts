import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), company: vi.fn(), revalidate: vi.fn(), from: vi.fn(),
  redirect: vi.fn(), rethrow: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: mocks.rethrow }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/email/sendTransactionalEmail', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/invoice-pdf-safe', () => ({ buildInvoicePdf: vi.fn() }))

import { createInvoiceFromJobsAtomic, type InvoiceDraftInput } from '../lib/dal/invoice-drafts'
import type { InvoiceIssueContext } from '../lib/dal/invoices'
import { createInvoiceFromJobs, createInvoiceDraftAction } from '../app/invoices/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const customerId = 'b1111111-1111-4111-8111-111111111111'
const invoiceId = 'c1111111-1111-4111-8111-111111111111'
const requestId = 'd1111111-1111-4111-8111-111111111111'
const jobA = 'e1111111-1111-4111-8111-111111111111'
const jobB = 'e2222222-2222-4222-8222-222222222222'
const result = { invoice_id: invoiceId, status: 'draft', created: true }
const redirectSignal = new Error('NEXT_REDIRECT')
const context = () => ({ companyId, supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc } }) as unknown as InvoiceIssueContext
const input = (): InvoiceDraftInput => ({
  customerId, requestId, jobIds: [jobB, jobA], issueDate: '2026-10-10',
  taxableSupplyDate: '2026-10-10', dueDate: '2026-10-24', vatRate: 21, note: ' Poděkování ',
})
const form = () => {
  const data = new FormData()
  data.set('companyId', companyId)
  for (const [key, value] of Object.entries(input())) {
    if (Array.isArray(value)) value.forEach((id) => data.append(key, id))
    else data.set(key, String(value ?? ''))
  }
  data.set('total_with_vat', '0.01')
  data.set('supplier_snapshot', '{"isVatPayer":false}')
  data.set('entitlementId', 'forged')
  data.set('invoice_number', 'forged')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.company.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
  mocks.rpc.mockResolvedValue({ data: result, error: null })
  mocks.from.mockImplementation(() => { throw new Error('Draft creation must use one transaction') })
  mocks.redirect.mockImplementation(() => { throw redirectSignal })
  mocks.rethrow.mockImplementation((error) => { if (error === redirectSignal) throw error })
})

describe('atomic draft boundary', () => {
  it('passes only scoped selections to one transaction after verified Auth', async () => {
    expect(await createInvoiceFromJobsAtomic(context(), input())).toEqual({ invoiceId, status: 'draft', created: true })
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('create_invoice_from_jobs_atomic', {
      target_company_id: companyId, target_customer_id: customerId, target_job_ids: [jobA, jobB],
      target_issue_date: '2026-10-10', target_taxable_supply_date: '2026-10-10', target_due_date: '2026-10-24',
      target_vat_rate: 21, target_note: 'Poděkování', target_request_id: requestId,
    })
  })
  it('canonicalizes UUID casing and order', async () => {
    await createInvoiceFromJobsAtomic({ ...context(), companyId: companyId.toUpperCase() }, {
      ...input(), customerId: customerId.toUpperCase(), requestId: requestId.toUpperCase(), jobIds: [jobB.toUpperCase(), jobA],
    })
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      target_company_id: companyId, target_customer_id: customerId, target_request_id: requestId, target_job_ids: [jobA, jobB],
    })
  })
  it.each([
    { customerId: '' }, { customerId: '../company' }, { requestId: '' }, { requestId: 'duplicate-key' },
    { jobIds: [] }, { jobIds: ['invalid'] }, { jobIds: [jobA, jobA.toUpperCase()] },
    { jobIds: Array(201).fill(jobA) }, { issueDate: '' }, { issueDate: '2026-02-29' },
    { issueDate: '2026-04-31' }, { issueDate: '2026-2-01' }, { issueDate: '1899-12-31' },
    { issueDate: '10000-01-01' }, { taxableSupplyDate: 'infinity' }, { dueDate: '2026-10-09' },
    { vatRate: -1 }, { vatRate: 100.01 }, { vatRate: 12.001 }, { vatRate: NaN }, { vatRate: Infinity },
    { note: 'a'.repeat(10001) },
  ])('rejects invalid input %j before any write', async (change) => {
    await expect(createInvoiceFromJobsAtomic(context(), { ...input(), ...change })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a malformed company before any write', async () => {
    await expect(createInvoiceFromJobsAtomic({ ...context(), companyId: '' }, input())).rejects.toThrow('aktivní firmy')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([0, 12.12, 100])('accepts valid VAT rate %s', async (vatRate) => {
    await expect(createInvoiceFromJobsAtomic(context(), { ...input(), vatRate })).resolves.toMatchObject({ created: true })
  })
  it('accepts leap day without altering it', async () => {
    await createInvoiceFromJobsAtomic(context(), { ...input(), issueDate: '2028-02-29', taxableSupplyDate: '2028-02-29', dueDate: '2028-03-14' })
    expect(mocks.rpc.mock.calls[0][1].target_issue_date).toBe('2028-02-29')
  })
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'unverified' } }, error: { message: 'token invalid' } },
  ])('denies unverified authentication', async (auth) => {
    mocks.auth.mockResolvedValue(auth)
    await expect(createInvoiceFromJobsAtomic(context(), input())).rejects.toThrow('oprávnění')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'])('accepts replay after original transitions to %s', async (status) => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ...result, status, created: false } })
    await expect(createInvoiceFromJobsAtomic(context(), input())).resolves.toEqual({ invoiceId, status, created: false })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    null, [], {}, true, { ...result, invoice_id: '../other' }, { ...result, created: 'true' },
    { ...result, status: 'issued' }, { ...result, status: 'cancelled' }, { ...result, status: 'unexpected', created: false },
  ])('does not report unconfirmed output %j as success or retry', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(createInvoiceFromJobsAtomic(context(), input())).rejects.toThrow('nepodařilo potvrdit')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['INVOICE_MODULE_REQUIRED', 'aktivní modul Fakturace'],
    ['INVOICE_DRAFT_FORBIDDEN', 'oprávnění'], ['INVOICE_ISSUE_FORBIDDEN', 'oprávnění'],
    ['INVOICE_CREATE_FORBIDDEN', 'oprávnění'], ['INVOICE_CREATE_INVALID', 'Zkontrolujte'],
    ['INVOICE_JOBS_INVALID', 'kladnou cenou'], ['INVOICE_REQUEST_CONFLICT', 'jinými údaji'],
    ['INVOICE_DRAFT_REQUEST_CONFLICT', 'jinými údaji'], ['INVOICE_DRAFT_REQUEST_GONE', 'smazán'],
    ['INVOICE_LINK_CONFLICT', 'jinou fakturou'], ['INVOICE_DRAFT_SCOPE_INVALID', 'aktivní firmy'],
    ['INVOICE_LINK_SCOPE_INVALID', 'aktivní firmy'], ['INVOICE_DRAFT_JOBS_INVALID', 'kladnou cenou'],
    ['INVOICE_DRAFT_INPUT_INVALID', 'Zkontrolujte'], ['private schema secret', 'nepodařilo potvrdit'],
  ])('translates %s into a safe actionable error', async (message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    await expect(createInvoiceFromJobsAtomic(context(), input())).rejects.toThrow(expected)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('draft server actions', () => {
  it('uses the server company and ignores posted prices/snapshots/licensing/number', async () => {
    await expect(createInvoiceFromJobs(form())).rejects.toBe(redirectSignal)
    expect(mocks.rpc.mock.calls[0][1]).toEqual({
      target_company_id: companyId, target_customer_id: customerId, target_job_ids: [jobA, jobB],
      target_issue_date: '2026-10-10', target_taxable_supply_date: '2026-10-10', target_due_date: '2026-10-24',
      target_vat_rate: 21, target_note: 'Poděkování', target_request_id: requestId,
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/invoices/${invoiceId}`)
    expect(mocks.revalidate.mock.calls).toEqual([['/invoices'], ['/invoices/new']])
  })
  it('denies a stale form after switching companies', async () => {
    const data = form()
    data.set('companyId', customerId)
    expect(await createInvoiceDraftAction({ error: null }, data)).toEqual({
      error: 'Aktivní firma se změnila. Znovu otevřete tvorbu faktury v požadované firmě.',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserves framework redirects from successful creation', async () => {
    await expect(createInvoiceDraftAction({ error: 'old error' }, form())).rejects.toBe(redirectSignal)
  })
  it('preserves authentication redirects without any write', async () => {
    mocks.company.mockRejectedValue(redirectSignal)
    await expect(createInvoiceDraftAction({ error: null }, form())).rejects.toBe(redirectSignal)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('keeps the same request id for a retry after an uncertain network response', async () => {
    const data = form()
    mocks.rpc.mockRejectedValueOnce(new Error('private network details')).mockResolvedValueOnce({ error: null, data: { ...result, created: false } })
    expect((await createInvoiceDraftAction({ error: null }, data)).error).toContain('stejný formulář')
    expect(mocks.revalidate).not.toHaveBeenCalled()
    await expect(createInvoiceDraftAction({ error: null }, data)).rejects.toBe(redirectSignal)
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1])
  })
  it.each(['no', '0x10', '1e1', '12.123', '-5', '101'])('rejects malformed or out-of-range submitted VAT %s', async (rate) => {
    const data = form()
    data.set('vatRate', rate)
    expect((await createInvoiceDraftAction({ error: null }, data)).error).toContain('Sazba DPH')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('accepts decimal comma input', async () => {
    const data = form()
    data.set('vatRate', '12,5')
    await expect(createInvoiceFromJobs(data)).rejects.toBe(redirectSignal)
    expect(mocks.rpc.mock.calls[0][1].target_vat_rate).toBe(12.5)
  })
  it('passes zero when non-payer disabled VAT field is absent; SQL still verifies payer status', async () => {
    const data = form()
    data.delete('vatRate')
    await expect(createInvoiceFromJobs(data)).rejects.toBe(redirectSignal)
    expect(mocks.rpc.mock.calls[0][1].target_vat_rate).toBe(0)
  })
  it('does not silently replace invalid dates with today', async () => {
    const data = form()
    data.set('issueDate', '2026-02-30')
    expect((await createInvoiceDraftAction({ error: null }, data)).error).toContain('platná data')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('never accepts a client previous-state error as authority', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'private SQL secret' }, data: null })
    const state = await createInvoiceDraftAction({ error: '<script>client</script>' }, form())
    expect(state.error).toContain('nepodařilo potvrdit')
    expect(state.error).not.toContain('secret')
    expect(state.error).not.toContain('script')
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
