import { describe, expect, it } from 'vitest'

import {
  buildJobEconomicsSummary,
  calculateQuotedJobEconomics,
  commonEconomicsCurrency,
  sumCompleteJobProfit,
  getDirectCostTotal,
  getInvoiceNetAmount,
  roundEconomicsMoney,
  toEconomicsNumber,
} from '../lib/economics'

describe('economics pure functions', () => {
  it('keeps an edited canonical zero instead of reviving stale invoice aliases', () => {
    expect(getInvoiceNetAmount({ total_without_vat: '0.00', total_price: 150, total_with_vat: 0 })).toBe(0)
    expect(getInvoiceNetAmount({ subtotal_without_vat: 0, total_without_vat: 100, total_amount: 121 })).toBe(0)
    expect(getInvoiceNetAmount({ subtotal_without_vat: '200.00', total_without_vat: 100, total_amount: 121 })).toBe(200)
  })

  it('uses legacy invoice amounts only when canonical amounts are absent', () => {
    expect(getInvoiceNetAmount({ total_without_vat: null, total_price: '75.50' })).toBe(75.5)
    expect(getInvoiceNetAmount({ total_amount: 100 })).toBe(100)
    expect(getInvoiceNetAmount({ total_without_vat: 'invalid', total_price: 150 })).toBe(0)
  })

  it('normalizes invalid numbers and rounds money values', () => {
    expect(toEconomicsNumber(null)).toBe(0)
    expect(toEconomicsNumber('not-a-number')).toBe(0)
    expect(toEconomicsNumber('12.5')).toBe(12.5)
    expect(roundEconomicsMoney(12.345)).toBe(12.35)
  })

  it('prefers explicit direct cost totals over quantity math', () => {
    expect(getDirectCostTotal({ total_price: 125, quantity: 10, unit_price: 20 })).toBe(125)
    expect(getDirectCostTotal({ quantity: '3', unit_price: '19.9' })).toBe(59.699999999999996)
  })

  it('builds one consistent profitability summary', () => {
    expect(
      buildJobEconomicsSummary({
        jobId: 'job-1',
        companyId: 'company-1',
        quotedRevenue: 1200,
        invoicedRevenue: 1000,
        laborHours: 8.555,
        internalLaborCost: 320.126,
        externalLaborCost: 180.123,
        directCost: 99.995,
      }),
    ).toEqual({
      job_id: 'job-1',
      company_id: 'company-1',
      quoted_revenue_total: 1200,
      revenue_total: 1000,
      labor_hours_total: 8.56,
      internal_labor_cost_total: 320.13,
      external_labor_cost_total: 180.12,
      labor_cost_total: 500.25,
      other_cost_total: 100,
      total_cost_total: 600.25,
      profit_total: 399.75,
      margin_percent: 39.98,
      currency: 'CZK', labor_completeness: 'complete', labor_cost_reasons: [],
      missing_rate_hours: 0, unapproved_labor_hours: 0, legacy_unverified_labor_count: 0,
      unconverted_labor_costs: [], provisional_labor_cost_total: 0,
      known_labor_cost_total: 500.25, known_cost_total: 600.25,
    })
  })
})


const base = { jobId: 'job-1', companyId: 'company-1', quotedRevenue: 2500, invoicedRevenue: 2500, laborHours: 8, internalLaborCost: 1600, externalLaborCost: 0, directCost: 10, currency: 'CZK' }
describe('incomplete labour never creates profit', () => {
  it.each(['incomplete', 'provisional'] as const)('preserves known costs but withholds totals for %s', laborCompleteness => {
    const summary = buildJobEconomicsSummary({ ...base, laborCompleteness, missingRateHours: 2, provisionalLaborCost: 400 })
    expect(summary).toMatchObject({ known_labor_cost_total: 1600, known_cost_total: 1610,
      labor_cost_total: null, total_cost_total: null, profit_total: null, margin_percent: null,
      provisional_labor_cost_total: 400, missing_rate_hours: 2 })
    expect(sumCompleteJobProfit([summary], 'CZK')).toBeNull()
  })
  it('keeps an explicit approved zero complete', () => {
    const summary = buildJobEconomicsSummary({ ...base, internalLaborCost: 0 })
    expect(summary).toMatchObject({ labor_cost_total: 0, total_cost_total: 10, profit_total: 2490, margin_percent: 99.6 })
  })
  it('does not hide missing labour behind a nonzero material cost', () => {
    const summary = buildJobEconomicsSummary({ ...base, internalLaborCost: 0, laborCompleteness: 'incomplete', missingRateHours: 8 })
    expect(summary.known_cost_total).toBe(10)
    expect(summary.profit_total).toBeNull()
    expect(calculateQuotedJobEconomics({ quotedRevenue: 2500, laborCost: summary.labor_cost_total, otherCost: 10 }).profit).toBeNull()
  })
  it('does not include an unconverted approved cost in a different currency', () => {
    const summary = buildJobEconomicsSummary({ ...base, unconvertedLaborCosts: [{ currency: 'EUR', amount: '100.00' }] })
    expect(summary).toMatchObject({ labor_completeness: 'incomplete', total_cost_total: null, margin_percent: null })
  })
  it('keeps incomplete parts and different currencies out of combined profit', () => {
    const complete = buildJobEconomicsSummary(base)
    expect(sumCompleteJobProfit([complete, complete], 'CZK')).toBe(1780)
    expect(sumCompleteJobProfit([complete, { ...complete, currency: 'EUR' }], 'CZK')).toBeNull()
    expect(sumCompleteJobProfit([complete, { ...complete, labor_completeness: 'incomplete' }], 'CZK')).toBeNull()
    expect(sumCompleteJobProfit([], 'CZK')).toBe(0)
  })
  it('cannot present provisional known subtotal as final quoted profit', () => {
    expect(calculateQuotedJobEconomics({ quotedRevenue: 2000, laborCost: 100, otherCost: 50, completeness: 'provisional' }))
      .toMatchObject({ knownTotalCost: 150, totalCost: null, profit: null, margin_percent: null })
  })
})

describe('combined currency evidence', () => {
  it('does not turn a mixed group represented by null into CZK', () => {
    expect(commonEconomicsCurrency([{ currency: null }])).toBeNull()
    expect(commonEconomicsCurrency([{ currency: 'EUR' }, { currency: null }])).toBeNull()
    expect(commonEconomicsCurrency([{ currency: 'EUR' }, { currency: 'CZK' }])).toBeNull()
    expect(commonEconomicsCurrency([{ currency: 'EUR' }, { currency: 'EUR' }])).toBe('EUR')
    expect(commonEconomicsCurrency([], 'EUR')).toBe('EUR')
  })
})
