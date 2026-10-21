import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(),
  DalAuthError: class extends Error {},
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.guard,
  requireHubDalContext: mocks.guard, DalAuthError: mocks.DalAuthError }))
import { createCalculationAction, updateCalculationAction } from '../app/business-actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const profileId = 'b1111111-1111-4111-8111-111111111111'
const operationId = 'c1111111-1111-4111-8111-111111111111'
const calculationId = 'd1111111-1111-4111-8111-111111111111'
const customerId = 'e1111111-1111-4111-8111-111111111111'
const otherId = 'f1111111-1111-4111-8111-111111111111'
const createInput = () => ({ companyId, profileId, operationId, customerId,
  title: 'Nulová zákaznická cena', description: null, status: 'draft', calculationDate: '2026-10-21',
  internalNote: 'Interní poznámka', currency: 'CZK', items: [
    { itemType: 'customer', name: 'Práce bez plnění', description: null, quantity: '1.00', unit: 'ks',
      unitCost: '0.00', unitPrice: '0.00', vatRate: '0.00', note: null },
    { itemType: 'material', name: 'Ruční materiál', description: null, quantity: '1.00', unit: 'ks',
      unitCost: '1.00', unitPrice: '0.00', vatRate: '0.00', note: 'Interní' },
  ],
})
const updateInput = () => ({ ...createInput(), calculationId, expectedRevision: '1' })
const receipt = (revision = '1', replayed = false) => ({ companyId, operationId, calculationId, revision, replayed })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ companyId, profileId, role: 'company_admin',
    supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from } })
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-auth-id' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: receipt(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('Split table access must never run') })
})

describe('atomic calculation server actions', () => {
  it('creates both zero-price and internal-cost rows in one authenticated RPC', async () => {
    expect(await createCalculationAction(createInput())).toEqual({ ok: true, data: receipt() })
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('company_admin', 'super_admin')
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('create_core_calculation_atomic', {
      p_company_id: companyId, p_operation_id: operationId,
      p_input: { customer_id: customerId, title: 'Nulová zákaznická cena', description: null,
        status: 'draft', calculation_date: '2026-10-21', internal_note: 'Interní poznámka', currency: 'CZK',
        items: createInput().items.map(item => ({ item_type: item.itemType, name: item.name,
          description: item.description, quantity: item.quantity, unit: item.unit,
          unit_cost: item.unitCost, unit_price: item.unitPrice, vat_rate: item.vatRate, note: item.note })),
      },
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith('/customers/' + customerId)
  })
  it('allows the standalone path without inventing a customer', async () => {
    expect(await createCalculationAction({ ...createInput(), customerId: null })).toMatchObject({ ok: true })
    expect(mocks.rpc.mock.calls[0][1].p_input.customer_id).toBeNull()
    expect(mocks.revalidate).toHaveBeenCalledWith('/kalkulace')
  })
  it('updates revision, history and all rows through exactly one RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: receipt('2'), error: null })
    expect(await updateCalculationAction(calculationId, updateInput())).toEqual({ ok: true, data: receipt('2') })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls[0][0]).toBe('update_core_calculation_atomic')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_company_id: companyId,
      p_calculation_id: calculationId, p_expected_revision: '1', p_operation_id: operationId })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith('/customers/' + customerId + '/calculations/' + calculationId)
  })
  it('rejects a mismatched route document before reaching a database', async () => {
    expect(await updateCalculationAction(otherId, updateInput())).toMatchObject({ ok: false, code: 'validation', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(['companyId', 'profileId'])('rejects a stale %s from a previous scope before RPC', async field => {
    expect(await createCalculationAction({ ...createInput(), [field]: otherId })).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects missing current authorization and Auth session', async () => {
    mocks.guard.mockRejectedValueOnce(new mocks.DalAuthError('private guard details'))
    expect(await createCalculationAction(createInput())).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    expect(await createCalculationAction(createInput())).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['', '1.001', '-1', 'NaN'])('rejects invalid quantities %s instead of silently coercing them', async quantity => {
    const input = createInput()
    input.items[0].quantity = quantity
    expect(await createCalculationAction(input)).toMatchObject({ ok: false, code: 'validation', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['CALCULATION_INVALID_INPUT', 'validation'], ['CALCULATION_NUMERIC_OVERFLOW', 'validation'],
    ['CALCULATION_FORBIDDEN', 'forbidden'], ['CALCULATION_MODULE_REQUIRED', 'forbidden'],
    ['CALCULATION_OPERATION_CONFLICT', 'conflict'], ['CALCULATION_REVISION_CONFLICT', 'conflict'],
  ])('returns a safe %s failure without sequential fallbacks', async (message, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message, details: 'private customer data', hint: 'private SQL' } })
    const result = await createCalculationAction(createInput())
    expect(result).toMatchObject({ ok: false, code, uncertain: false })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(['transport', 'invalid-success', 'cache-refresh'])('keeps a retryable operation after %s uncertainty', async mode => {
    if (mode === 'transport') mocks.rpc.mockRejectedValueOnce(new Error('private connection string'))
    if (mode === 'invalid-success') mocks.rpc.mockResolvedValueOnce({ data: {}, error: null })
    if (mode === 'cache-refresh') mocks.revalidate.mockImplementationOnce(() => { throw new Error('private cache error') })
    const first = await createCalculationAction(createInput())
    expect(first).toMatchObject({ ok: false, code: 'unknown', uncertain: true })
    expect(JSON.stringify(first)).not.toContain('private')
    mocks.rpc.mockResolvedValue({ data: receipt('1', true), error: null })
    expect(await createCalculationAction(createInput())).toEqual({ ok: true, data: receipt('1', true) })
    expect(mocks.rpc.mock.calls.map(call => call[1].p_operation_id)).toEqual([operationId, operationId])
    expect(mocks.rpc.mock.calls[0][1].p_input).toEqual(mocks.rpc.mock.calls[1][1].p_input)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns a revision-conflict update without refreshing away the unsaved form', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'CALCULATION_REVISION_CONFLICT' } })
    expect(await updateCalculationAction(calculationId, updateInput())).toMatchObject({ ok: false, code: 'conflict', uncertain: false })
    expect(mocks.revalidate).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
