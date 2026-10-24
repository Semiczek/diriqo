import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readCompleteEconomicsRows } from '../lib/dal/economics-pages'
const rows = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) }))
describe('complete financial source reads', () => {
  it('fetches beyond the API cap in stable ordered pages', async () => {
    const read = vi.fn(async (offset: number) => ({ data: rows.slice(offset, offset + 500), count: rows.length, error: null }))
    expect(await readCompleteEconomicsRows(read)).toHaveLength(1201)
    expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 500, 1000])
  })
  it('fails when the server truncates a page even if a smaller result looks plausible', async () => {
    await expect(readCompleteEconomicsRows(async () => ({ data: rows.slice(0, 100), count: 1201, error: null }))).rejects.toThrow('neúplné')
  })
  it('fails when source rows were added or removed between pages', async () => {
    await expect(readCompleteEconomicsRows(async offset => ({ data: rows.slice(offset, offset + 500), count: offset ? 1200 : 1201, error: null }))).rejects.toThrow('Úplnost')
  })
  it('fails on a duplicate page instead of counting it twice', async () => {
    await expect(readCompleteEconomicsRows(async () => ({ data: rows.slice(0, 500), count: 1201, error: null }))).rejects.toThrow('změnily')
  })
  it('does not guess a complete result without an exact count', async () => {
    await expect(readCompleteEconomicsRows(async () => ({ data: [], count: null, error: null }))).rejects.toThrow('Úplnost')
  })
  it('keeps source failures visible and accepts a proved empty set', async () => {
    await expect(readCompleteEconomicsRows(async () => ({ data: null, count: null, error: new Error('offline') }))).rejects.toThrow('offline')
    expect(await readCompleteEconomicsRows(async () => ({ data: [], count: 0, error: null }))).toEqual([])
  })
})
