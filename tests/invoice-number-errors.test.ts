import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ company: vi.fn(), from: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ from: mocks.from }) }))
vi.mock('@/lib/email/sendTransactionalEmail', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/invoice-pdf-safe', () => ({ buildInvoicePdf: vi.fn() }))

import { invoiceWriteError } from '../lib/dal/invoices'
import { updateDraftInvoice } from '../app/invoices/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const invoiceId = 'b1111111-1111-4111-8111-111111111111'
const itemId = 'c1111111-1111-4111-8111-111111111111'
const duplicateMessage = 'Toto číslo faktury už v aktivní firmě existuje.'
const databaseMessage = 'duplicate key value violates unique constraint "invoices_company_number_uidx"'
type DatabaseError = { code?: string; message: string; details?: string; hint?: string }
const conflict = (): DatabaseError => ({ code: '23505', message: databaseMessage,
  details: `Key (company_id, invoice_number)=(${companyId}, PRIVATE-CONFLICT-VALUE) already exists.`, hint: '' })
type QueryCall = { table: string; operation: string; values: Record<string, unknown>; filters: Record<string, unknown> }
let queries: QueryCall[]
let headerError: DatabaseError | null
let duplicateRows: Array<{ id: string }>
let invoiceStatus: string

function form() {
  const data = new FormData()
  data.set('invoiceId', invoiceId)
  data.set('companyId', 'forged-company')
  data.set('invoiceNumber', '2026-0001')
  data.set('itemIds', itemId)
  data.set(`itemName_${itemId}`, 'Synthetic invoice item')
  data.set(`itemQuantity_${itemId}`, '2')
  data.set(`itemPrice_${itemId}`, '100')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  queries = []
  headerError = null
  duplicateRows = []
  invoiceStatus = 'draft'
  mocks.company.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {}
    let operation = 'select'
    let values: Record<string, unknown> = {}
    const execute = () => {
      queries.push({ table, operation, values, filters })
      return { data: operation === 'select' ? duplicateRows : null,
        error: table === 'invoices' && operation === 'update' ? headerError : null }
    }
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters[column] = value; return query },
      neq: (column: string, value: unknown) => { filters[`not.${column}`] = value; return query },
      limit: () => query,
      update: (payload: Record<string, unknown>) => { operation = 'update'; values = payload; return query },
      maybeSingle: async () => {
        queries.push({ table, operation, values, filters })
        return { data: { id: invoiceId, company_id: companyId, customer_id: 'synthetic-customer',
          status: invoiceStatus, invoice_number: null }, error: null }
      },
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  })
})

describe('invoice number conflict mapping', () => {
  it('maps the exact PostgREST code and constraint message without exposing conflict values', () => {
    const error = invoiceWriteError(conflict())
    expect(error.message).toBe(duplicateMessage)
    expect(error.message).not.toContain(companyId)
    expect(error.message).not.toContain('PRIVATE-CONFLICT-VALUE')
  })

  it('preserves the existing explicit RPC number-conflict error', () => {
    expect(invoiceWriteError({ message: 'INVOICE_NUMBER_CONFLICT' }).message).toBe(duplicateMessage)
  })

  it.each([
    { code: '23505', message: 'duplicate key value violates unique constraint "invoice_draft_requests_pkey"' },
    { code: '23505', message: 'duplicate key value violates unique constraint "invoices_company_number_uidx_other"' },
    { code: '23503', message: databaseMessage },
    { message: databaseMessage },
    { code: '23505', message: 'duplicate key value violates unique constraint "other_idx"', details: databaseMessage },
    { code: '23505', message: 'unknown database error', hint: databaseMessage },
    { code: '23505', message: 'private-table PRIVATE-CONFLICT-VALUE' },
  ])('does not misclassify another error or copy its private diagnostics: %j', (error) => {
    expect(invoiceWriteError(error).message).toBe('Vystavení faktury se nepodařilo potvrdit. Obnovte stránku před opakováním akce.')
  })

  it('does not inspect PostgREST details while recognizing the named constraint', () => {
    const error = conflict()
    Object.defineProperty(error, 'details', { get: () => { throw new Error('Details must not be inspected') } })
    expect(invoiceWriteError(error).message).toBe(duplicateMessage)
  })
})

describe('draft header number collision', () => {
  it('stops after a raced header conflict even when the earlier duplicate lookup found nothing', async () => {
    headerError = conflict()
    await expect(updateDraftInvoice(form())).rejects.toThrow(duplicateMessage)
    expect(queries.map(({ table, operation }) => [table, operation])).toEqual([
      ['invoices', 'select'], ['invoices', 'select'], ['invoices', 'update'],
    ])
    expect(queries[2].filters).toEqual({ id: invoiceId, company_id: companyId, status: 'draft' })
    expect(mocks.from).not.toHaveBeenCalledWith('invoice_items')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('does not leak or mislabel an unrelated header uniqueness error', async () => {
    headerError = { code: '23505', message: 'duplicate key PRIVATE-CONFLICT-VALUE in unrelated_constraint',
      details: databaseMessage }
    await expect(updateDraftInvoice(form())).rejects.toThrow('Uložení konceptu faktury se nepodařilo potvrdit. Obnovte stránku před opakováním akce.')
    expect(mocks.from).not.toHaveBeenCalledWith('invoice_items')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('keeps the existing preflight duplicate rejection before any header write', async () => {
    duplicateRows = [{ id: 'another-invoice' }]
    await expect(updateDraftInvoice(form())).rejects.toThrow(duplicateMessage)
    expect(queries.every(query => query.operation === 'select')).toBe(true)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('keeps successful draft item updates and cache refreshes', async () => {
    await updateDraftInvoice(form())
    expect(queries.map(({ table, operation }) => [table, operation])).toEqual([
      ['invoices', 'select'], ['invoices', 'select'], ['invoices', 'update'], ['invoice_items', 'update'],
    ])
    expect(queries[3].filters).toEqual({ id: itemId, invoice_id: invoiceId })
    expect(queries[3].values).toMatchObject({ item_name: 'Synthetic invoice item', quantity: 2,
      unit_price_without_vat: 100, total_with_vat: 200 })
    expect(mocks.revalidate.mock.calls).toEqual([[`/invoices/${invoiceId}`], ['/invoices']])
  })

  it('still denies a non-draft before duplicate lookup or writes', async () => {
    invoiceStatus = 'issued'
    await expect(updateDraftInvoice(form())).rejects.toThrow('Upravovat lze jen koncept faktury.')
    expect(queries).toHaveLength(1)
    expect(queries[0].operation).toBe('select')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('still requires the company guard before accessing the table', async () => {
    mocks.company.mockRejectedValue(new Error('company access denied'))
    await expect(updateDraftInvoice(form())).rejects.toThrow('company access denied')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
