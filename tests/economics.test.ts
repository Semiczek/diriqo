import { describe, expect, it } from 'vitest'

import {
  buildJobEconomicsSummary,
  getDirectCostTotal,
  roundEconomicsMoney,
  toEconomicsNumber,
} from '../lib/economics'

describe('economics pure functions', () => {
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
    })
  })
})

