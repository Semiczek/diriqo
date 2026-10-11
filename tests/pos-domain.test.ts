import { describe, expect, it } from 'vitest'
import { cashRefund, csvCell, lineTotal, moneyInput, payableTotal, quantityInput, refundPart, validateEnvelope } from '../lib/pos/domain'

describe('DiriPOS money and partial corrections', () => {
  it('reads Czech inputs without floating point drift and rejects fractional minor units', () => {
    expect(moneyInput('1,23')).toBe(123)
    expect(moneyInput('1000000000.00')).toBe(100000000000)
    expect(quantityInput('0,001')).toBe(1)
    for (const bad of ['1.234', '-1', 'NaN', 'Infinity', '1e3', '', '1 234', '1000000000.01']) expect(() => moneyInput(bad)).toThrow()
    expect(() => quantityInput('0.0001')).toThrow()
  })
  it('prices fractional quantities, rounds cash to crowns, preserves external payment cents', () => {
    expect(lineTotal(12345, 1500)).toBe(18518)
    expect(payableTotal(18549, 'cash')).toBe(18500)
    expect(payableTotal(18550, 'cash')).toBe(18600)
    expect(payableTotal(18550, 'external')).toBe(18550)
    expect(() => lineTotal(100, 0)).toThrow()
    expect(() => lineTotal(-1, 1000)).toThrow()
  })
  it('allocates partial returns cumulatively instead of over-refunding repeated rounded thirds', () => {
    const parts = [refundPart(100, 3000, 0, 1000), refundPart(100, 3000, 1000, 1000), refundPart(100, 3000, 2000, 1000)]
    expect(parts).toEqual([33, 34, 33])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(() => refundPart(100, 3000, 2000, 1001)).toThrow()
    expect(() => refundPart(100, 3000, -1, 1000)).toThrow()
  })
  it('cash refunds sum to exactly the original rounded payment for every partition', () => {
    for (const gross of [49, 50, 99, 101, 149, 150, 999, 1001, 18518]) {
      const paid = payableTotal(gross, 'cash')
      let cumulative = 0; let refunded = 0
      for (let count = 0; count < 7; count++) {
        cumulative += refundPart(gross, 7000, count * 1000, 1000)
        const part = cashRefund(gross, paid, cumulative, refunded)
        expect(part).toBeGreaterThanOrEqual(0)
        expect(part % 100).toBe(0)
        refunded += part
        expect(refunded).toBeLessThanOrEqual(paid)
      }
      expect(refunded).toBe(paid)
    }
  })
  it('rejects malformed command identities rather than coercing tenant/register input', () => {
    const command = { companyId: '11111111-1111-4111-8111-111111111111', registerId: '22222222-2222-4222-8222-222222222222', eventId: '33333333-3333-4333-8333-333333333333', command: 'sale', payload: {} }
    expect(validateEnvelope(command)).toEqual(command)
    for (const change of [{ companyId: '' }, { registerId: null }, { eventId: 'retry' }, { command: 'sql' }, { payload: [] }]) expect(() => validateEnvelope({ ...command, ...change })).toThrow()
  })
  it('escapes document references and formula-like content in exported CSV', () => {
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell(' \t@SUM(A1)')).toBe('"\' \t@SUM(A1)"')
  })
})
