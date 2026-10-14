import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { invoiceWriteError } from '../lib/dal/invoices'
const companyId = 'a1111111-1111-4111-8111-111111111111'
const duplicateMessage = 'Toto číslo faktury už v aktivní firmě existuje.'
const databaseMessage = 'duplicate key value violates unique constraint "invoices_company_number_uidx"'
type DatabaseError = { code?: string; message: string; details?: string; hint?: string }
const conflict = (): DatabaseError => ({ code: '23505', message: databaseMessage,
  details: `Key (company_id, invoice_number)=(${companyId}, PRIVATE-CONFLICT-VALUE) already exists.`, hint: '' })

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
