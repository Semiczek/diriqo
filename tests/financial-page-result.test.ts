import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readCompleteFinancialResult } from '../lib/dal/financial-page-result'
import { sumCostsInCurrency } from '../lib/cost-overview'

const rows = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), amount: '1.25', currency: 'CZK' }))
describe('financial page unavailable versus complete source', () => {
  it('uses all pages for the final total, including rows beyond 500 and 1000', async () => {
    const read = vi.fn(async (offset: number) => ({ data: rows.slice(offset, offset + 500), count: rows.length, error: null }))
    const result = await readCompleteFinancialResult(read)
    expect(result.error).toBeNull()
    expect(sumCostsInCurrency(result.data, 'CZK')).toBe(1251.25)
    expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 500, 1000])
  })
  it('discards a previously read prefix when the next page fails', async () => {
    const result = await readCompleteFinancialResult(async offset => offset
      ? { data: null, count: null, error: { message: 'unavailable' } }
      : { data: rows.slice(0, 500), count: rows.length, error: null })
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(sumCostsInCurrency(result.data, 'CZK')).toBeNull()
  })
  it('does not publish a prefix after a count change', async () => {
    const result = await readCompleteFinancialResult(async offset => ({ data: rows.slice(offset, offset + 500), count: offset ? 1000 : 1001, error: null }))
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })
  it('does not accept a plausible truncated dataset or missing exact count', async () => {
    const truncated = await readCompleteFinancialResult(async () => ({ data: rows.slice(0, 500), count: 1001, error: null }))
    expect(truncated.data).toBeNull()
    const unknown = await readCompleteFinancialResult(async () => ({ data: [], count: null, error: null }))
    expect(unknown.data).toBeNull()
  })
  it('only a proved empty source produces zero', async () => {
    const result = await readCompleteFinancialResult(async () => ({ data: [], count: 0, error: null }))
    expect(result).toEqual({ data: [], error: null })
    expect(sumCostsInCurrency(result.data, 'CZK')).toBe(0)
  })
})
