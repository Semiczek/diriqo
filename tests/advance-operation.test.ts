import { describe, expect, it, vi } from 'vitest'
import { executeAdvanceOperation, type AdvanceOperationPayload } from '../lib/payroll/advance-operation'

describe('uncertain advance confirmations', () => {
  it('keeps the committed operation through lost response, forbidden retry, reload and successful deduplication', async () => {
    let stored: AdvanceOperationPayload | null = null
    let activeCompany = 'A'
    const ledger = new Map<string, number>()
    const newOperationId = vi.fn(() => 'original-operation')
    const calls: AdvanceOperationPayload[] = []
    let loseResponse = true
    const submit = () => executeAdvanceOperation({
      pending: stored, payload: { amount: '1000', profileId: 'worker' }, companyId: 'A', newOperationId,
      store: operation => { stored = JSON.parse(JSON.stringify(operation)) }, clear: () => { stored = null },
      action: async operation => {
        calls.push(operation)
        if (activeCompany !== operation.companyId) return { ok: false, uncertain: false }
        const id = String(operation.operationId)
        if (!ledger.has(id)) ledger.set(id, Number(operation.amount))
        if (loseResponse) { loseResponse = false; throw new Error('lost response after commit') }
        return { ok: true }
      },
    })
    await expect(submit()).rejects.toThrow('lost response')
    expect(ledger.size).toBe(1)
    activeCompany = 'B'
    expect(await submit()).toEqual({ ok: false, uncertain: false })
    expect(stored).toMatchObject({ operationId: 'original-operation', amount: '1000' })
    activeCompany = 'A'
    expect(await submit()).toEqual({ ok: true })
    expect(stored).toBeNull()
    expect(calls.map(call => call.operationId)).toEqual(Array(3).fill('original-operation'))
    expect(newOperationId).toHaveBeenCalledOnce()
    expect([...ledger.values()]).toEqual([1000])
  })
  it.each([true, false])('clears only an immediately rejected new operation (uncertain=%s)', async uncertain => {
    const clear = vi.fn()
    await executeAdvanceOperation({ pending: null, payload: {}, companyId: 'A', newOperationId: () => 'K', store: vi.fn(), clear,
      action: async () => ({ ok: false, uncertain }) })
    expect(clear).toHaveBeenCalledTimes(uncertain ? 0 : 1)
  })
})
