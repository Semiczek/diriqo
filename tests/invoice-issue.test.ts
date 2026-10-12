import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), company: vi.fn(), revalidate: vi.fn(), from: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/email/sendTransactionalEmail', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/invoice-pdf-safe', () => ({ buildInvoicePdf: vi.fn() }))

import { issueInvoiceAtomic, deleteInvoiceDraftAtomic, type InvoiceIssueContext } from '../lib/dal/invoices'
import { issueInvoice as flowIssue } from '../lib/dal/flow'
import { issueInvoice as actionIssue, deleteInvoicePermanently } from '../app/invoices/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const invoiceId = 'b1111111-1111-4111-8111-111111111111'
const otherInvoiceId = 'b2222222-2222-4222-8222-222222222222'
const result = { invoice_id: invoiceId, invoice_number: '2026-0001', status: 'issued', issued: true }
const context = () => ({
  companyId,
  supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc },
}) as unknown as InvoiceIssueContext
const form = () => {
  const data = new FormData()
  data.set('invoiceId', invoiceId)
  data.set('companyId', 'c3333333-3333-4333-8333-333333333333')
  data.set('invoiceNumber', 'forged')
  data.set('issued_at', '2000-01-01')
  data.set('entitlementId', 'forged')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null })
  mocks.company.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
  mocks.rpc.mockResolvedValue({ data: result, error: null })
  mocks.from.mockImplementation(() => { throw new Error('Issue must use a single database transaction') })
})

describe('shared invoice issue boundary', () => {
  it('uses verified Auth and one scoped RPC with no client licensing/numbering authority', async () => {
    expect(await issueInvoiceAtomic(context(), invoiceId)).toEqual({
      invoiceId, invoiceNumber: '2026-0001', status: 'issued', issued: true, alreadyIssued: false,
    })
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('issue_invoice_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId,
    })
  })

  it('normalizes UUID casing before the transaction and response validation', async () => {
    await expect(issueInvoiceAtomic({ ...context(), companyId: companyId.toUpperCase() }, invoiceId.toUpperCase()))
      .resolves.toMatchObject({ invoiceId })
    expect(mocks.rpc).toHaveBeenCalledWith('issue_invoice_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId,
    })
  })

  it.each(['', 'not-a-uuid', `${invoiceId}/../other`])('rejects invalid invoice id %j before writes', async (id) => {
    await expect(issueInvoiceAtomic(context(), id)).rejects.toThrow('aktivní firmě')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid company scope before writes', async () => {
    await expect(issueInvoiceAtomic({ ...context(), companyId: '' }, invoiceId)).rejects.toThrow('aktivní firmě')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'unverified' } }, error: { message: 'invalid token' } },
  ])('does not use an unauthenticated request', async (auth) => {
    mocks.auth.mockResolvedValue(auth)
    await expect(issueInvoiceAtomic(context(), invoiceId)).rejects.toThrow('oprávnění')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['issued', 'sent', 'paid', 'overdue'])('accepts an idempotent repeat in state %s', async (status) => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ...result, status, issued: false } })
    await expect(issueInvoiceAtomic(context(), invoiceId)).resolves.toMatchObject({ issued: false, alreadyIssued: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['INVOICE_MODULE_REQUIRED', 'aktivní modul Fakturace'],
    ['INVOICE_ISSUE_FORBIDDEN', 'oprávnění'],
    ['INVOICE_NOT_FOUND', 'aktivní firmě'],
    ['INVOICE_INVALID_STATE', 'tomto stavu'],
    ['INVOICE_LINK_SCOPE_INVALID', 'neplatnou vazbu'],
    ['INVOICE_LINK_CONFLICT', 'jinou fakturou'],
    ['INVOICE_NUMBER_CONFLICT', 'číslo faktury'],
    ['internal database secret', 'nepodařilo potvrdit'],
  ])('returns a safe action error for %s without retry', async (message, expected) => {
    mocks.rpc.mockResolvedValue({ data: result, error: { message } })
    await expect(issueInvoiceAtomic(context(), invoiceId)).rejects.toThrow(expected)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    null, [], {}, true,
    { ...result, invoice_id: otherInvoiceId },
    { ...result, issued: 'true' },
    { ...result, status: 'draft' },
    { ...result, status: 'paid', issued: true },
    { ...result, invoice_number: '' },
    { ...result, invoice_number: null },
  ])('does not report malformed/mismatched provider data %j as success', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(issueInvoiceAtomic(context(), invoiceId)).rejects.toThrow('nepodařilo potvrdit')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('both application entrypoints', () => {
  it('uses the server company in the form action, ignoring extra client fields', async () => {
    await actionIssue(form())
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('issue_invoice_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId,
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate.mock.calls).toEqual([['/invoices'], [`/invoices/${invoiceId}`], ['/jobs']])
  })

  it('does not invalidate as successful after database denial', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'INVOICE_MODULE_REQUIRED' } })
    await expect(actionIssue(form())).rejects.toThrow('aktivní modul Fakturace')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('maps the number constraint conflict without retry, child writes or success revalidation', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "invoices_company_number_uidx"',
      details: 'Key (company_id, invoice_number)=(private-company, PRIVATE-CONFLICT-VALUE) already exists.',
      hint: '',
    } })
    await expect(actionIssue(form())).rejects.toThrow('Toto číslo faktury už v aktivní firmě existuje.')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('requires the current company guard before executing the form', async () => {
    mocks.company.mockRejectedValue(new Error('company access denied'))
    await expect(actionIssue(form())).rejects.toThrow('company access denied')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('the flow DAL delegates to the same transaction and preserves its return contract', async () => {
    expect(await flowIssue(context(), invoiceId)).toEqual({ issued: true, alreadyIssued: false })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('issue_invoice_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('the flow DAL never reports cancelled invoices as already issued', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'INVOICE_INVALID_STATE' } })
    await expect(flowIssue(context(), invoiceId)).rejects.toThrow('tomto stavu')
  })
})

describe('atomic draft deletion', () => {
  it('removes the draft with one scoped transaction and no preceding table writes', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { invoice_id: invoiceId, deleted: true } })
    await deleteInvoicePermanently(form())
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('delete_invoice_draft_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId,
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith('/invoices')
  })
  it('denies issued/exported deletion without any partial cleanup', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'INVOICE_DELETE_FORBIDDEN' } })
    await expect(deleteInvoicePermanently(form())).rejects.toThrow('Ostatní doklady zůstávají v historii')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('checks verified authentication', async () => {
    mocks.auth.mockResolvedValue({ error: null, data: { user: null } })
    await expect(deleteInvoiceDraftAtomic(context(), invoiceId)).rejects.toThrow('oprávnění')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a malformed identifier before writing', async () => {
    await expect(deleteInvoiceDraftAtomic(context(), '')).rejects.toThrow('aktivní firmě')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([null, {}, { invoice_id: otherInvoiceId, deleted: true }, { invoice_id: invoiceId, deleted: false }])(
    'does not report an unconfirmed deletion %j as complete', async (data) => {
      mocks.rpc.mockResolvedValue({ error: null, data })
      await expect(deleteInvoiceDraftAtomic(context(), invoiceId)).rejects.toThrow('nepodařilo potvrdit')
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
    },
  )
  it('does not expose raw SQL errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private-table constraint internal-details' } })
    await expect(deleteInvoiceDraftAtomic(context(), invoiceId)).rejects.toThrow('nepodařilo potvrdit')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
