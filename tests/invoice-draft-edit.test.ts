import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), company: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }) }))
vi.mock('@/lib/email/sendTransactionalEmail', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/invoice-pdf-safe', () => ({ buildInvoicePdf: vi.fn() }))

import { getInvoiceEditSnapshot, invoiceDraftEditError, issueInvoiceRevisionAtomic, refreshInvoiceSupplierAtomic, updateInvoiceDraftAtomic, type InvoiceDraftEditInput } from '../lib/dal/invoice-drafts'
import type { InvoiceIssueContext } from '../lib/dal/invoices'
import { issueInvoiceRevisionAction, refreshInvoiceSupplierAction, updateDraftInvoice, updateInvoiceDraftAction } from '../app/invoices/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const invoiceId = 'b1111111-1111-4111-8111-111111111111'
const itemId = 'c1111111-1111-4111-8111-111111111111'
const revision = 'a'.repeat(64)
const nextRevision = 'b'.repeat(64)
const state = { error: null, reloadRequired: false }
const result = () => ({ invoice_id: invoiceId, status: 'draft', revision: nextRevision, updated: true })
const context = () => ({ companyId, supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc } }) as unknown as InvoiceIssueContext
const input = (): InvoiceDraftEditInput => ({
  invoiceId, expectedRevision: revision, expectedItemIds: [itemId],
  header: { invoiceNumber: '2026-1', variableSymbol: null, issueDate: '2026-10-12', taxableSupplyDate: '2026-10-12', dueDate: '2026-10-26', note: 'Keep my note', supplier: { name: 'Supplier' }, customer: { name: 'Customer' } },
  items: [{ id: itemId, itemName: 'Work', description: null, quantity: '0.05', unit: 'hod', unitPriceWithoutVat: '0.70', vatRate: '21.00' }],
})
function form() {
  const data = new FormData()
  data.set('companyId', companyId)
  data.set('invoiceId', invoiceId)
  data.set('revision', revision)
  data.append('itemIds', itemId)
  data.set('invoiceNumber', '2026-1')
  data.set('issueDate', '2026-10-12')
  data.set('taxableSupplyDate', '2026-10-12')
  data.set('dueDate', '2026-10-26')
  data.set('note', 'Keep my note')
  data.set('supplierName', 'Supplier')
  data.set('supplierIban', 'SYNTHETIC-IBAN')
  data.set('customerName', 'Customer')
  data.set(`itemName_${itemId}`, 'Work')
  data.set(`itemQuantity_${itemId}`, '0,05')
  data.set(`itemPrice_${itemId}`, '0.70')
  data.set(`itemVatRate_${itemId}`, '21.00')
  data.set(`itemUnit_${itemId}`, 'hod')
  data.set('supplierIsVatPayer', 'false')
  data.set('supplierLogoUrl', 'forged-logo')
  data.set('total_with_vat', '0.01')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.company.mockResolvedValue({ companyId, role: 'company_admin' })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('No table reads or writes may precede/follow the RPC') })
})

describe('revision-aware invoice DAL', () => {
  it('sends exact decimal strings, item identity and snapshots through one authenticated RPC', async () => {
    const payload = input()
    expect(await updateInvoiceDraftAtomic(context(), payload)).toEqual({ invoiceId, revision: nextRevision })
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('update_invoice_draft_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId, expected_revision: revision,
      expected_item_ids: [itemId], header_input: payload.header, item_inputs: payload.items,
    })
    expect(payload.items[0].quantity).toBe('0.05')
  })

  it.each([
    { expectedRevision: '' }, { expectedRevision: 'updated_at' }, { expectedRevision: 'a'.repeat(63) },
    { expectedItemIds: [itemId, itemId] }, { expectedItemIds: [''] }, { expectedItemIds: [] },
    { items: [] }, { items: [{ ...input().items[0], id: companyId }] },
    { items: [{ ...input().items[0], quantity: 'NaN' }] },
    { items: [{ ...input().items[0], unitPriceWithoutVat: '1e5' }] },
  ])('rejects malformed revisions or item sets without normalizing them into valid requests: %j', async change => {
    await expect(updateInvoiceDraftAtomic(context(), { ...input(), ...change })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not silently deduplicate UUIDs with different case', async () => {
    await expect(refreshInvoiceSupplierAtomic(context(), { ...input(), expectedItemIds: [itemId, itemId.toUpperCase()] })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('requires verified Auth, not only a supplied company', async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    await expect(updateInvoiceDraftAtomic(context(), input())).rejects.toThrow('nemáte oprávnění')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([null, {}, { ...result(), invoice_id: companyId }, { ...result(), updated: false },
    { ...result(), status: 'issued' }, { ...result(), revision: 'bad' }])('does not claim success for an ambiguous write result %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(updateInvoiceDraftAtomic(context(), input())).rejects.toMatchObject({ reloadRequired: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('passes excessive precision unchanged for the DB to reject instead of rounding it into a valid price', async () => {
    const payload = input()
    payload.items[0].quantity = '1.005'
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'INVOICE_DRAFT_INPUT_INVALID', code: '22023' } })
    await expect(updateInvoiceDraftAtomic(context(), payload)).rejects.toThrow('Zkontrolujte')
    expect(mocks.rpc.mock.calls[0][1].item_inputs[0].quantity).toBe('1.005')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('does not retry a lost response or expose transport diagnostics', async () => {
    mocks.rpc.mockRejectedValue(new Error('PRIVATE CONNECTION DATA'))
    await expect(updateInvoiceDraftAtomic(context(), input())).rejects.toThrow('Výsledek změny faktury se nepodařilo potvrdit')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('refreshes only by exact invoice identity/revision/items, without replacing note or snapshot in JS', async () => {
    await refreshInvoiceSupplierAtomic(context(), input())
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('refresh_invoice_supplier_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId, expected_revision: revision, expected_item_ids: [itemId],
    })
  })

  it('requires the seen revision when issuing, preserving the existing issue result contract', async () => {
    mocks.rpc.mockResolvedValue({ data: { invoice_id: invoiceId, status: 'issued', invoice_number: '2026-1', issued: true }, error: null })
    expect(await issueInvoiceRevisionAtomic(context(), input())).toEqual({ invoiceId, invoiceNumber: '2026-1', status: 'issued', issued: true, alreadyIssued: false })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('issue_invoice_revision_atomic', {
      target_company_id: companyId, target_invoice_id: invoiceId, expected_revision: revision,
    })
  })

  it('reads header, ordered items and matching revision in one snapshot RPC', async () => {
    const snapshot = { invoice: { id: invoiceId, company_id: companyId }, items: [{ id: itemId, invoice_id: invoiceId, company_id: companyId }], revision }
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null })
    expect(await getInvoiceEditSnapshot(context(), invoiceId)).toEqual(snapshot)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_invoice_edit_snapshot', { target_company_id: companyId, target_invoice_id: invoiceId })
  })

  it.each([
    { invoice: { id: invoiceId, company_id: itemId }, items: [], revision },
    { invoice: { id: invoiceId, company_id: companyId }, items: [{ id: itemId, invoice_id: companyId }], revision },
    { invoice: { id: invoiceId, company_id: companyId }, items: [], revision: 'bad' },
    { invoice: { id: invoiceId, company_id: companyId }, items: [{ id: itemId, invoice_id: invoiceId, company_id: itemId }], revision },
  ])('refuses a mismatched snapshot: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(getInvoiceEditSnapshot(context(), invoiceId)).rejects.toThrow()
  })

  it('returns not found for a scoped missing invoice', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'INVOICE_NOT_FOUND' } })
    expect(await getInvoiceEditSnapshot(context(), invoiceId)).toBeNull()
  })
})

describe('draft actions', () => {
  it('does no duplicate preflight or child table writes and revalidates only confirmed success', async () => {
    await updateDraftInvoice(form())
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledOnce()
    const args = mocks.rpc.mock.calls[0][1]
    expect(args.item_inputs[0]).toMatchObject({ quantity: '0.05', unitPriceWithoutVat: '0.70', vatRate: '21.00' })
    expect(args.header_input.supplier.iban).toBe('SYNTHETIC-IBAN')
    expect(args.header_input.supplier).not.toHaveProperty('isVatPayer')
    expect(args.header_input.supplier).not.toHaveProperty('logoUrl')
    expect(args.header_input).not.toHaveProperty('total_with_vat')
    expect(mocks.revalidate.mock.calls).toEqual([[`/invoices/${invoiceId}`], ['/invoices']])
  })

  it.each([updateInvoiceDraftAction, refreshInvoiceSupplierAction, issueInvoiceRevisionAction])('denies a form opened before a company switch', async action => {
    const data = form(); data.set('companyId', itemId)
    const error = await action(state, data)
    expect(error).toMatchObject({ reloadRequired: true })
    expect(error.error).toContain('Aktivní firma se změnila')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each([updateInvoiceDraftAction, refreshInvoiceSupplierAction, issueInvoiceRevisionAction])('returns a safe stale error without revalidating away the form', async action => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'INVOICE_DRAFT_STALE', details: 'PRIVATE' } })
    const result = await action(state, form())
    expect(result.error).toContain('Fakturu mezitím někdo změnil')
    expect(result.reloadRequired).toBe(true)
    expect(result.error).not.toContain('PRIVATE')
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('returns the exact named number conflict without details or subsequent writes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "invoices_company_number_uidx"', details: 'PRIVATE NUMBER' } })
    expect(await updateInvoiceDraftAction(state, form())).toEqual({ error: 'Toto číslo faktury už v aktivní firmě existuje.', reloadRequired: false })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('does not normalize duplicate submitted IDs or a missing numeric field', async () => {
    const duplicate = form(); duplicate.append('itemIds', itemId)
    expect((await updateInvoiceDraftAction(state, duplicate)).reloadRequired).toBe(true)
    const missing = form(); missing.delete(`itemQuantity_${itemId}`)
    expect((await updateInvoiceDraftAction(state, missing)).error).toContain('Zkontrolujte')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not expose unknown errors or revalidate when the response is lost', async () => {
    mocks.rpc.mockRejectedValue(new Error('PRIVATE TOKEN'))
    const outcome = await updateInvoiceDraftAction(state, form())
    expect(outcome.reloadRequired).toBe(true)
    expect(outcome.error).not.toContain('PRIVATE')
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('requires the company guard before calling Auth/RPC', async () => {
    mocks.company.mockRejectedValue(new Error('PRIVATE GUARD'))
    const outcome = await updateInvoiceDraftAction(state, form())
    expect(outcome.error).not.toContain('PRIVATE')
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['INVOICE_DRAFT_FORBIDDEN', 'INVOICE_MODULE_REQUIRED', 'INVOICE_INVALID_STATE', 'INVOICE_DRAFT_ITEMS_INVALID'])('maps known denial safely: %s', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    const outcome = await updateInvoiceDraftAction(state, form())
    expect(outcome.reloadRequired).toBe(true)
    expect(outcome.error).not.toContain('INVOICE_')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('does not classify unrelated unique conflicts from private details', () => {
    const outcome = invoiceDraftEditError({ code: '23505', message: 'PRIVATE other index' })
    expect(outcome.message).not.toContain('PRIVATE')
    expect(outcome.message).not.toContain('číslo faktury')
    expect(outcome.reloadRequired).toBe(true)
  })
})
