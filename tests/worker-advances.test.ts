import { describe, expect, it } from 'vitest'
import { advanceAmount, advanceAmountCents, advanceBalance, payrollAdvanceTotal, sumAdvancePayments } from '../lib/payroll/advances'

describe('C08 advance amounts and one financial source', () => {
  it('tracks 3000 approved as 1000 + 2000, without adding the request a second time', () => {
    const payments = [{ id: 'first', amount: '1000.00' }, { id: 'second', amount: '2000.00' }]
    expect(advanceBalance('3000.00', payments.slice(0, 1))).toEqual({ approved: 3000, paid: 1000, remaining: 2000 })
    expect(advanceBalance('3000.00', payments)).toEqual({ approved: 3000, paid: 3000, remaining: 0 })
    expect(payrollAdvanceTotal(payments, [])).toBe(3000)
  })
  it('preserves cents without rounding user input into another monetary amount', () => {
    expect(advanceAmount(' 0,10 ')).toBe('0.10')
    expect(sumAdvancePayments([{ id: 'a', amount: '0.10' }, { id: 'b', amount: '0.20' }])).toBe(0.3)
    expect(advanceAmountCents('9999999999.99')).toBe(999999999999)
    for (const amount of ['1e3', '-1', '0', 'NaN', 'Infinity', '1.001', '10000000000', '', null, Infinity]) {
      expect(() => advanceAmountCents(amount)).toThrow()
    }
  })
  it('fails closed for duplicate records and overpayment instead of hiding them with max(0)', () => {
    expect(() => sumAdvancePayments([{ id: 'a', amount: 1 }, { id: 'a', amount: 1 }])).toThrow(/duplicitní/)
    expect(() => advanceBalance(1000, [{ id: 'a', amount: 1000.01 }])).toThrow(/překračují/)
  })
  it('return reduces the wage advance; offset confirms the same deduction once', () => {
    const payments = [{ id: 'p', amount: 3000 }]
    const settlements = [
      { id: 'r', worker_advance_id: 'p', amount: 1000, method: 'returned' as const },
      { id: 'o', worker_advance_id: 'p', amount: 2000, method: 'payroll_offset' as const },
    ]
    expect(sumAdvancePayments(payments)).toBe(3000)
    expect(payrollAdvanceTotal(payments, settlements)).toBe(2000)
    expect(advanceBalance(3000, settlements).remaining).toBe(0)
    expect(payrollAdvanceTotal(payments, settlements.slice(1))).toBe(3000)
  })
  it('ties settlements to the payment, even when their date is in another month', () => {
    expect(payrollAdvanceTotal([{ id: 'october', amount: 1000 }], [
      { id: 'r', worker_advance_id: 'october', amount: 400, method: 'returned' },
      { id: 'another-worker', worker_advance_id: 'not-in-period', amount: 900, method: 'returned' },
    ])).toBe(600)
    expect(() => payrollAdvanceTotal([{ id: 'a', amount: 50 }], [
      { id: 'r', worker_advance_id: 'a', amount: 51, method: 'returned' },
    ])).toThrow(/překračuje/)
  })
})
