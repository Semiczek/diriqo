import { describe, expect, it } from 'vitest'
import { combineKnownCosts, financialCurrency, sumCostsInCurrency, sumFixedCostsInMonth } from '../lib/cost-overview'
import type { FixedCostRow } from '../lib/costs'

const row = (overrides: Partial<FixedCostRow> = {}): FixedCostRow => ({
  id: 'rent', company_id: 'company', name: 'Rent', category: 'Nájem', amount: '100.00', currency: 'CZK',
  recurrence: 'monthly', start_date: '2026-01-01', end_date: null, is_active: true,
  due_day: 10, note: null, created_at: null, updated_at: null, ...overrides,
})
const inOctober = (rows: FixedCostRow[] | null) => sumFixedCostsInMonth(rows, '2026-10-01', '2026-11-01', 'CZK')

describe('financial cost currency totals', () => {
  it('adds verified amounts in minor units and normalizes explicit currency codes', () => {
    expect(sumCostsInCurrency([{ amount: '0.10', currency: 'czk' }, { amount: 0.2, currency: ' CZK ' }], 'CZK')).toBe(0.3)
    expect(financialCurrency(' eur ')).toBe('EUR')
  })
  it('distinguishes a proved empty set from unavailable data and missing company currency', () => {
    expect(sumCostsInCurrency([], 'CZK')).toBe(0)
    expect(sumCostsInCurrency(null, 'CZK')).toBeNull()
    expect(sumCostsInCurrency([], null)).toBeNull()
    expect(sumCostsInCurrency([], 'unknown')).toBeNull()
  })
  it('refuses to relabel a foreign amount even when its amount is zero', () => {
    expect(sumCostsInCurrency([{ amount: 100, currency: 'CZK' }, { amount: 200, currency: 'EUR' }], 'CZK')).toBeNull()
    expect(sumCostsInCurrency([{ amount: 0, currency: 'EUR' }], 'CZK')).toBeNull()
  })
  it.each([null, undefined, '', 'EURO'])('does not substitute company currency for row currency %s', currency => {
    expect(sumCostsInCurrency([{ amount: 100, currency }], 'CZK')).toBeNull()
  })
  it.each([null, undefined, '', 'bad', -1, NaN, Infinity, '1.234', 0.1 + 0.2])('does not replace invalid amount %s with zero', amount => {
    expect(sumCostsInCurrency([{ amount, currency: 'CZK' }], 'CZK')).toBeNull()
  })
  it('refuses amounts or accumulated cents beyond exact numeric precision', () => {
    expect(sumCostsInCurrency([{ amount: '90071992547409.92', currency: 'CZK' }], 'CZK')).toBeNull()
    expect(sumCostsInCurrency([{ amount: '90071992547409.91', currency: 'CZK' }, { amount: '0.01', currency: 'CZK' }], 'CZK')).toBeNull()
  })
})

describe('monthly fixed cost completeness', () => {
  it('includes overlapping monthly costs and one-time costs only in their starting month', () => {
    expect(inOctober([row(), row({ id: 'one', recurrence: 'one_time', start_date: '2026-10-31', amount: 50 })])).toBe(150)
    expect(inOctober([row({ recurrence: 'one_time', start_date: '2026-09-30' })])).toBe(0)
  })
  it('ignores inactive and out-of-period costs without inventing a conversion', () => {
    expect(inOctober([
      row(), row({ currency: 'EUR', is_active: false }),
      row({ currency: 'EUR', start_date: '2026-11-01' }),
      row({ currency: 'EUR', end_date: '2026-09-30' }),
    ])).toBe(100)
  })
  it('includes a cost ending on the first day and rejects foreign costs active in the month', () => {
    expect(inOctober([row({ end_date: '2026-10-01' })])).toBe(100)
    expect(inOctober([row({ currency: 'EUR', start_date: '2026-10-31' })])).toBeNull()
  })
  it.each(['weekly', 'yearly', 'unknown', null])('keeps unsupported recurrence %s unresolved, rather than zero', recurrence => {
    expect(inOctober([row({ recurrence })])).toBeNull()
  })
  it.each([
    { start_date: null }, { start_date: '2026-02-30' }, { end_date: 'invalid' },
    { end_date: '2025-01-01' }, { is_active: null },
  ])('refuses ambiguous fixed cost periods or activity %j', changes => {
    expect(inOctober([row(changes)])).toBeNull()
  })
  it('distinguishes unavailable and proved empty fixed costs', () => {
    expect(inOctober(null)).toBeNull()
    expect(inOctober([])).toBe(0)
    expect(sumFixedCostsInMonth([], '2026-11-01', '2026-10-01', 'CZK')).toBeNull()
    expect(sumFixedCostsInMonth([], 'bad', '2026-11-01', 'CZK')).toBeNull()
  })
})

describe('complete combined cost result', () => {
  it('keeps totals unavailable if either source is unavailable or incomparable', () => {
    expect(combineKnownCosts(100, null)).toBeNull()
    expect(combineKnownCosts(null, 0)).toBeNull()
    expect(combineKnownCosts(100, Infinity)).toBeNull()
  })
  it('combines known totals without a floating point residual', () => {
    expect(combineKnownCosts(0.1, 0.2)).toBe(0.3)
    expect(combineKnownCosts(0, 0)).toBe(0)
  })
})
