import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readAdvanceLedger, readPayrollAdvanceLedger } from '../lib/dal/worker-advances'
import { readAdvanceSettings, readWorkerPaydayOverrides } from '../lib/dal/advance-settings'
import type { SupabaseServerClient } from '../lib/dal/auth'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const profileId = 'b1111111-1111-4111-8111-111111111111'
const payment = (id: string) => ({ id, company_id: companyId, profile_id: profileId, payroll_month: '2026-10-01', amount: 1 })
type Row = Record<string, unknown>
function client(tables: Record<string, Row[]>, errorTable?: string) {
  const calls: Array<[string, string, unknown[]]> = []
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    const chain = {
      select(...args: unknown[]) { calls.push([table, 'select', args]); return chain },
      eq(column: string, value: unknown) { calls.push([table, 'eq', [column, value]]); filters.push(row => row[column] === value); return chain },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return chain },
      order(...args: unknown[]) { calls.push([table, 'order', args]); return chain },
      or(...args: unknown[]) { calls.push([table, 'or', args]); return chain },
      range(start: number, end: number) {
        calls.push([table, 'range', [start, end]])
        return Promise.resolve({ data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(start, end + 1), error: table === errorTable ? { message: 'unavailable' } : null })
      },
      single: async () => ({ data: tables[table]?.[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: (tables[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null, error: null }),
    }
    return chain
  })
  return { supabase: { from } as unknown as SupabaseServerClient, calls, from }
}

describe('financial readers', () => {
  it('reads beyond the default 1000 rows and batches linked settlements without synthetic requests', async () => {
    const payments = Array.from({ length: 1001 }, (_, i) => payment(`payment-${i}`))
    const db = client({ worker_advances: payments, worker_advance_settlements: [{ id: 'return-last', company_id: companyId, profile_id: profileId, worker_advance_id: 'payment-1000', amount: 1 }] })
    const result = await readAdvanceLedger(db.supabase, companyId, { payrollMonth: '2026-10-01' })
    expect(result.payments).toHaveLength(1001)
    expect(result.settlements).toHaveLength(1)
    expect(db.calls.filter(([table, op]) => table === 'worker_advances' && op === 'range').map(([, , args]) => args)).toEqual([[0, 499], [500, 999], [1000, 1499]])
    expect(db.from).not.toHaveBeenCalledWith('advance_requests')
  })
  it('explicitly constrains all queries to the current company and own worker when requested', async () => {
    const db = client({ worker_advances: [payment('p'), { ...payment('foreign'), company_id: 'foreign' }, { ...payment('other-worker'), profile_id: 'other-worker' }] })
    const result = await readAdvanceLedger(db.supabase, companyId, { profileId })
    expect(result.payments.map(p => p.id)).toEqual(['p'])
    expect(db.calls).toContainEqual(['worker_advances', 'eq', ['company_id', companyId]])
    expect(db.calls).toContainEqual(['worker_advances', 'eq', ['profile_id', profileId]])
    expect(db.calls).toContainEqual(['worker_advance_settlements', 'eq', ['company_id', companyId]])
  })
  it('does not silently turn a failed settlement query into a zero deduction', async () => {
    const db = client({ worker_advances: [payment('p')] }, 'worker_advance_settlements')
    expect(await readPayrollAdvanceLedger(db.supabase, companyId)).toMatchObject({ data: [], error: { message: expect.any(String) } })
  })
  it('requires reconciliation instead of reassigning a historical NULL payroll month', async () => {
    const db = client({ worker_advances: [{ ...payment('legacy'), payroll_month: null }] })
    await expect(readAdvanceLedger(db.supabase, companyId, { payrollMonth: '2026-10-01' })).rejects.toThrow(/mzdové období/)
  })
})

describe('canonical advance settings', () => {
  const company = { id: companyId, default_currency: 'EUR', currency: 'CZK' }
  it('preserves a canonical false and a NULL payday instead of legacy/global fallback', async () => {
    const db = client({ companies: [company], company_payroll_settings: [{ company_id: companyId, advances_enabled: false, payday_day: null, allow_advances: true, payroll_day_of_month: 18 }] })
    expect(await readAdvanceSettings(db.supabase, companyId, profileId)).toMatchObject({ currency: 'EUR', advancesAllowed: false, payday: null })
    expect(db.from).not.toHaveBeenCalledWith('profiles')
  })
  it('uses only the company-scoped active override for a worker shared by two companies', async () => {
    const db = client({ companies: [company], company_payroll_settings: [{ company_id: companyId, advances_enabled: false, payday_day: 12 }], worker_payment_settings: [
      { company_id: 'other-company', profile_id: profileId, is_active: true, advances_enabled_override: true, payday_day_override: 1 },
      { company_id: companyId, profile_id: profileId, is_active: true, advances_enabled_override: null, payday_day_override: 25 },
    ] })
    expect(await readAdvanceSettings(db.supabase, companyId, profileId)).toMatchObject({ advancesAllowed: false, payday: 25 })
  })
  it('uses defaults only when the company row is absent and rejects unknown currency', async () => {
    const db = client({ companies: [company] })
    expect(await readAdvanceSettings(db.supabase, companyId)).toMatchObject({ advancesAllowed: true, payday: null })
    const bad = client({ companies: [{ id: companyId, currency: null, default_currency: null }] })
    await expect(readAdvanceSettings(bad.supabase, companyId)).rejects.toThrow(/měnu/)
  })
  it('exports scoped payday overrides without borrowing another company or inactive settings', async () => {
    const db = client({ worker_payment_settings: [
      { company_id: companyId, profile_id: profileId, is_active: true, payday_day_override: 31, pay_type_override: 'monthly' },
      { company_id: 'other', profile_id: profileId, is_active: true, payday_day_override: 1, pay_type_override: 'weekly' },
      { company_id: companyId, profile_id: 'inactive', is_active: false, payday_day_override: 18 },
    ] })
    expect(await readWorkerPaydayOverrides(db.supabase, companyId)).toEqual(new Map([[profileId, { payday: 31, payType: 'monthly' }]]))
  })
})
