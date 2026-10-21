import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_CALCULATION_ITEM_TYPES, CoreCalculationSaveError, coreCalculationSaveError,
  normalizeCoreCalculationDecimal, parseCoreCalculationSave, parseCoreCalculationSaveReceipt,
  previewCoreCalculationItems, type CoreCalculationCreateInput, type CoreCalculationItemInput,
  type CoreCalculationSaveReceipt, type CoreCalculationUpdateInput,
} from '../lib/core-calculation-save'
vi.mock('server-only', () => ({}))
import { createCoreCalculation, updateCoreCalculation } from '../lib/dal/core-calculation-save'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const otherCompanyId = 'a2222222-2222-4222-8222-222222222222'
const profileId = 'b1111111-1111-4111-8111-111111111111'
const operationId = 'c1111111-1111-4111-8111-111111111111'
const calculationId = 'd1111111-1111-4111-8111-111111111111'
const customerId = 'e1111111-1111-4111-8111-111111111111'
const item = (change: Partial<CoreCalculationItemInput> = {}): CoreCalculationItemInput => ({
  itemType: 'customer', name: 'Úklid', description: null, quantity: '1.00', unit: 'hod',
  unitCost: '0.00', unitPrice: '120.00', vatRate: '21.00', note: null, ...change,
})
const input = (change: Partial<CoreCalculationCreateInput> = {}): CoreCalculationCreateInput => ({
  companyId, profileId, operationId, customerId, title: 'Kalkulace', description: null,
  status: 'draft', calculationDate: '2026-10-21', internalNote: null, currency: 'CZK',
  items: [item()], ...change,
})
const edit = (change: Partial<CoreCalculationUpdateInput> = {}): CoreCalculationUpdateInput => ({
  ...input(), calculationId, expectedRevision: '1', ...change,
})
const successful = (change: Partial<CoreCalculationSaveReceipt> = {}): CoreCalculationSaveReceipt => ({
  companyId, operationId, calculationId, revision: '1', replayed: false, ...change,
})
const getUser = vi.fn(), rpc = vi.fn(), from = vi.fn()
const ctx = (change: Record<string, unknown> = {}) => ({
  companyId, profileId, role: 'company_admin', supabase: { auth: { getUser }, rpc, from }, ...change,
}) as unknown as Parameters<typeof createCoreCalculation>[0]
beforeEach(() => {
  vi.resetAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  rpc.mockResolvedValue({ data: successful(), error: null })
  from.mockImplementation(() => { throw new Error('Split table writes are forbidden') })
})

describe('calculation save contract', () => {
  it('normalizes UUIDs, whitespace and decimal strings without changing meaning', () => {
    const parsed = parseCoreCalculationSave(input({
      companyId: companyId.toUpperCase(), profileId: profileId.toUpperCase(), operationId: operationId.toUpperCase(),
      customerId: customerId.toUpperCase(), title: '  Výpočet  ', description: '  ', internalNote: '  Interní  ',
      items: [item({ name: '  Řádek  ', description: ' ', quantity: '001,50', unit: ' hod ', unitPrice: '00012.5', vatRate: '021' })],
    }))
    expect(parsed).toEqual(input({
      title: 'Výpočet', internalNote: 'Interní',
      items: [item({ name: 'Řádek', quantity: '1.50', unitPrice: '12.50' })],
    }))
  })
  it('preserves every supported internal type and stable item order', () => {
    const items = CORE_CALCULATION_ITEM_TYPES.map(itemType => item({
      itemType, name: itemType, unitPrice: itemType === 'customer' ? '1.00' : '0.00',
      unitCost: itemType === 'customer' ? '0.00' : '1.00',
    }))
    expect(parseCoreCalculationSave(input({ items })).items).toEqual(items)
  })
  it('preserves explicit zero amounts and a negative margin', () => {
    const preview = previewCoreCalculationItems([
      item({ unitPrice: '0', vatRate: '0' }),
      item({ itemType: 'labor', unitCost: '1', unitPrice: '0', vatRate: '0' }),
    ])
    expect(preview).toMatchObject({ subtotalCost: '1.00', subtotalPrice: '0.00', marginAmount: '-1.00' })
    expect(preview.items[0].unitPrice).toBe('0.00')
  })
  it.each(['', ' ', '1.001', '-1', '+1', '1e2', 'Infinity', '.50', '1.', '1,2,3', '1 000', null, undefined, 1, NaN])(
    'does not guess or round invalid decimal input %j', value => {
      expect(() => normalizeCoreCalculationDecimal(value)).toThrow(CoreCalculationSaveError)
    },
  )
  it.each([
    { quantity: '0' }, { vatRate: '100.01' }, { unitCost: '0.01' },
    { itemType: 'labor', unitCost: '1', unitPrice: '0.01' },
    { itemType: null }, { itemType: 'misc' }, { vatRate: undefined }, { name: '' }, { name: 'x'.repeat(301) },
    { description: 'x'.repeat(4001) }, { note: 'x'.repeat(4001) }, { unit: 'x'.repeat(51) },
    { note: 'a\0b' }, { id: 'client-row' }, { total_price: '999' }, { totalPrice: '999' },
  ])('rejects an invalid item before saving: %j', change => {
    expect(() => parseCoreCalculationSave({ ...input(), items: [{ ...item(), ...change }] })).toThrow(CoreCalculationSaveError)
  })
  it('counts text limits as Unicode characters like PostgreSQL, not UTF-16 units', () => {
    const name = '🧽'.repeat(300)
    expect(parseCoreCalculationSave(input({ title: name, items: [item({ name })] })).title).toBe(name)
    expect(() => parseCoreCalculationSave(input({ title: name + 'x' }))).toThrow(CoreCalculationSaveError)
  })
  it.each([
    { title: '' }, { title: 'x'.repeat(301) }, { description: 'x'.repeat(10001) }, { internalNote: 'x'.repeat(10001) },
    { companyId: 'bad' }, { profileId: undefined }, { operationId: null }, { customerId: undefined },
    { currency: 'EUR' }, { status: 'sent' }, { items: [] }, { items: null }, { actorId: profileId }, { subtotalPrice: '0' },
    { expectedRevision: '1' }, { calculationId },
  ])('rejects an invalid create header or unknown field: %j', change => {
    expect(() => parseCoreCalculationSave({ ...input(), ...change })).toThrow(CoreCalculationSaveError)
  })
  it('accepts a null customer and optional null/blank text', () => {
    expect(parseCoreCalculationSave(input({ customerId: null, description: null, internalNote: ' ' })))
      .toMatchObject({ customerId: null, description: null, internalNote: null })
  })
  it('allows zero preview rows, but bounds persisted rows at one through 500', () => {
    expect(previewCoreCalculationItems([])).toMatchObject({ items: [], totalPrice: '0.00', marginAmount: '0.00' })
    expect(parseCoreCalculationSave(input({ items: Array.from({ length: 500 }, () => item({ unitPrice: '0' })) })).items).toHaveLength(500)
    expect(() => parseCoreCalculationSave(input({ items: Array.from({ length: 501 }, () => item()) }))).toThrow(CoreCalculationSaveError)
  })
  it.each(['0001-01-01', '2024-02-29', '9999-12-31'])('preserves explicit valid ISO date %s', calculationDate => {
    expect(parseCoreCalculationSave(input({ calculationDate })).calculationDate).toBe(calculationDate)
  })
  it.each([null, undefined, '', '0000-01-01', '2026-02-29', '2026-04-31', '2026-10-21T00:00:00Z', '21.10.2026'])(
    'rejects invalid or missing date %j instead of silently using today', calculationDate => {
      expect(() => parseCoreCalculationSave({ ...input(), calculationDate })).toThrow(CoreCalculationSaveError)
    },
  )
  it('keeps revision values above the JavaScript safe integer as exact strings', () => {
    expect(parseCoreCalculationSave(edit({ expectedRevision: '9007199254740993' }), 'update').expectedRevision).toBe('9007199254740993')
    expect(parseCoreCalculationSave(edit({ expectedRevision: '9223372036854775807' }), 'update').expectedRevision).toBe('9223372036854775807')
  })
  it.each([undefined, null, 1, '0', '-1', '01', '1.0', '9223372036854775808'])('rejects invalid update revision %j', expectedRevision => {
    expect(() => parseCoreCalculationSave({ ...edit(), expectedRevision }, 'update')).toThrow(CoreCalculationSaveError)
  })
})

describe('exact calculation preview', () => {
  it('matches PostgreSQL half-up row rounding before summing', () => {
    const preview = previewCoreCalculationItems([
      item({ quantity: '0.50', unitPrice: '0.01', vatRate: '0' }),
      item({ quantity: '0.50', unitPrice: '0.01', vatRate: '0' }),
      item({ quantity: '1.01', unitPrice: '1.50', vatRate: '0' }),
    ])
    expect(preview.items.map(row => row.totalPrice)).toEqual(['0.01', '0.01', '1.52'])
    expect(preview.totalPrice).toBe('1.54')
  })
  it('calculates tax, labor, other costs and margin from rounded line values', () => {
    const preview = previewCoreCalculationItems([
      item({ quantity: '1.01', unitPrice: '1.50', vatRate: '21' }),
      item({ itemType: 'labor', unitCost: '0.03', unitPrice: '0', vatRate: '50' }),
      item({ itemType: 'material', quantity: '0.50', unitCost: '0.01', unitPrice: '0', vatRate: '100' }),
    ])
    expect(preview).toMatchObject({
      subtotalPrice: '1.52', subtotalCost: '0.04', marginAmount: '1.48',
      vatAmount: '0.32', costVatAmount: '0.03', totalWithVat: '1.84', totalCostWithVat: '0.07',
      laborCost: '0.03', otherCost: '0.01',
    })
  })
  it('handles maximum numeric(12,2) values with exact unpersisted gross totals', () => {
    const preview = previewCoreCalculationItems([item({ unitPrice: '9999999999.99', vatRate: '100' })])
    expect(preview.totalPrice).toBe('9999999999.99')
    expect(preview.totalWithVat).toBe('19999999999.98')
    expect(previewCoreCalculationItems([item({ itemType: 'labor', unitPrice: '0', unitCost: '9999999999.99' })]).marginAmount).toBe('-9999999999.99')
  })
  it.each([
    [item({ quantity: '10000000000' })],
    [item({ unitPrice: '10000000000' })],
    [item({ quantity: '2', unitPrice: '9999999999.99' })],
    [item({ unitPrice: '9999999999.99' }), item({ unitPrice: '0.01' })],
    [item({ itemType: 'labor', unitPrice: '0', quantity: '2', unitCost: '9999999999.99' })],
    [item({ itemType: 'labor', unitPrice: '0', unitCost: '9999999999.99' }), item({ itemType: 'material', unitPrice: '0', unitCost: '0.01' })],
  ])('rejects an unrepresentable persisted row or total %#', (...items) => {
    expect(() => previewCoreCalculationItems(items)).toThrow(CoreCalculationSaveError)
    expect(() => parseCoreCalculationSave(input({ items }))).toThrow(CoreCalculationSaveError)
  })
})


describe('authenticated atomic calculation DAL', () => {
  it('sends the complete normalized header and items in one RPC after fresh authentication', async () => {
    expect(await createCoreCalculation(ctx(), input())).toEqual(successful())
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('create_core_calculation_atomic', {
      p_company_id: companyId, p_operation_id: operationId,
      p_input: {
        customer_id: customerId, title: 'Kalkulace', description: null, status: 'draft',
        calculation_date: '2026-10-21', internal_note: null, currency: 'CZK',
        items: [{ item_type: 'customer', name: 'Úklid', description: null, quantity: '1.00', unit: 'hod',
          unit_cost: '0.00', unit_price: '120.00', vat_rate: '21.00', note: null }],
      },
    })
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0])
    expect(from).not.toHaveBeenCalled()
  })
  it('updates against the exact bigint revision and validates the receipt for that original operation', async () => {
    rpc.mockResolvedValue({ data: successful({ revision: '9007199254740994', replayed: true }), error: null })
    expect(await updateCoreCalculation(ctx(), edit({ expectedRevision: '9007199254740993' })))
      .toEqual(successful({ revision: '9007199254740994', replayed: true }))
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc.mock.calls[0][0]).toBe('update_core_calculation_atomic')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_calculation_id: calculationId, p_expected_revision: '9007199254740993' })
    expect(from).not.toHaveBeenCalled()
  })
  it('reuses the unchanged request after a lost response and accepts the authoritative replay', async () => {
    const original = input(), snapshot = structuredClone(original)
    rpc.mockRejectedValueOnce(new Error('secret transport failure'))
    await expect(createCoreCalculation(ctx(), original)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    rpc.mockResolvedValueOnce({ data: successful({ replayed: true }), error: null })
    expect(await createCoreCalculation(ctx(), original)).toEqual(successful({ replayed: true }))
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
    expect(original).toEqual(snapshot)
    expect(from).not.toHaveBeenCalled()
  })
  it.each([
    { companyId: otherCompanyId }, { profileId: customerId }, { role: 'manager' }, { role: 'worker' }, { role: null },
  ])('rejects a stale company/actor or unauthorized role before RPC: %j', change => {
    return expect(createCoreCalculation(ctx(change), input())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
      .then(() => { expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled() })
  })
  it('supports super admins only within the verified company and actor context', async () => {
    expect(await createCoreCalculation(ctx({ role: 'super_admin' }), input())).toEqual(successful())
    await expect(createCoreCalculation(ctx({ role: 'super_admin', companyId: otherCompanyId }), input()))
      .rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'old-user' } }, error: { message: 'secret expired' } },
  ])('requires current authentication even with a server context', async authResponse => {
    getUser.mockResolvedValue(authResponse)
    await expect(createCoreCalculation(ctx(), input())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid input before authenticating or mutating', async () => {
    await expect(createCoreCalculation(ctx(), input({ calculationDate: '' }))).rejects.toMatchObject({ code: 'validation', uncertain: false })
    expect(getUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['CALCULATION_INVALID_INPUT', 'validation'], ['CALCULATION_FORBIDDEN', 'forbidden'],
    ['CALCULATION_MODULE_REQUIRED', 'forbidden'], ['CALCULATION_NOT_FOUND', 'forbidden'],
    ['CALCULATION_CUSTOMER_NOT_FOUND', 'forbidden'], ['CALCULATION_OPERATION_CONFLICT', 'conflict'],
    ['CALCULATION_REVISION_CONFLICT', 'conflict'], ['CALCULATION_NUMERIC_OVERFLOW', 'validation'],
    ['CALCULATION_RESULT_MISSING', 'unavailable'],
  ])('maps %s without leaking SQL details or claiming success', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message, details: 'secret SQL and data' } })
    const result = await createCoreCalculation(ctx(), input()).catch(error => error)
    expect(result).toBeInstanceOf(CoreCalculationSaveError)
    expect(result).toMatchObject({ code, uncertain: false })
    expect(result.message).not.toContain('secret')
    expect(result.message).not.toContain(message)
    expect(rpc).toHaveBeenCalledOnce()
    expect(from).not.toHaveBeenCalled()
  })
  it.each([
    null, [], {}, successful({ companyId: otherCompanyId }), successful({ operationId: customerId }),
    { ...successful(), calculationId: 'bad' }, { ...successful(), revision: 1 },
    successful({ revision: '0' }), successful({ revision: '2' }), successful({ revision: '9223372036854775808' }),
    { ...successful(), replayed: 'false' },
  ])('keeps malformed committed receipts uncertain %#', async data => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(createCoreCalculation(ctx(), input())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([
    successful({ calculationId: customerId, revision: '2' }),
    successful({ revision: '1', replayed: true }),
    successful({ revision: '3', replayed: true }),
  ])('rejects a receipt from another update or a later revision %#', async data => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(updateCoreCalculation(ctx(), edit())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('shares the receipt contract with the UI and strips unknown response fields', () => {
    expect(parseCoreCalculationSaveReceipt({ ...successful(), private: 'not forwarded' }, input())).toEqual(successful())
    expect(parseCoreCalculationSaveReceipt(successful({ revision: '2', replayed: true }), edit(), 'update'))
      .toEqual(successful({ revision: '2', replayed: true }))
    expect(() => parseCoreCalculationSaveReceipt(successful(), edit(), 'update')).toThrow(CoreCalculationSaveError)
  })
  it.each(['auth-throw', 'rpc-throw', 'unknown-provider-error'])('does not reveal raw failures after %s', async failure => {
    if (failure === 'auth-throw') getUser.mockRejectedValue(new Error('secret auth failure'))
    if (failure === 'rpc-throw') rpc.mockRejectedValue(new Error('secret transport failure'))
    if (failure === 'unknown-provider-error') rpc.mockResolvedValue({ data: null, error: { message: 'secret database failure' } })
    const result = await createCoreCalculation(ctx(), input()).catch(error => error)
    expect(result).toMatchObject({ code: 'unknown', uncertain: true })
    expect(result.message).not.toContain('secret')
    expect(from).not.toHaveBeenCalled()
  })
  it('preserves a deliberate known typed error and safely classifies arbitrary errors', () => {
    const known = new CoreCalculationSaveError('Ověřená chyba', 'conflict', false)
    expect(coreCalculationSaveError(known)).toBe(known)
    expect(coreCalculationSaveError({ message: 'CALCULATION_INVALID_INPUT suffix' })).toMatchObject({ code: 'unknown', uncertain: true })
    expect(coreCalculationSaveError(null)).toMatchObject({ code: 'unknown', uncertain: true })
    for (const message of ['constructor', '__proto__', 'toString']) {
      expect(coreCalculationSaveError({ message })).toMatchObject({ code: 'unknown', uncertain: true })
    }
  })
})

describe('calculation request size before storing a pending operation', () => {
  it('accepts a substantial normalized UTF-8 request below the framework boundary', () => {
    const items = Array.from({ length: 100 }, () => item({ unitPrice: '0', description: '🧽'.repeat(1000) }))
    expect(parseCoreCalculationSave(input({ items })).items).toHaveLength(100)
  })
  it('rejects individually valid fields exceeding 512 KiB in total before any request can become pending', () => {
    const items = Array.from({ length: 150 }, () => item({ unitPrice: '0', description: '🧽'.repeat(1000) }))
    expect(() => parseCoreCalculationSave(input({ items }))).toThrow('Kalkulace obsahuje příliš mnoho textu.')
    expect(() => parseCoreCalculationSave(edit({ items }), 'update')).toThrow('Kalkulace obsahuje příliš mnoho textu.')
  })
  it('bounds the normalized payload, so trimmed whitespace does not count as retained content', () => {
    expect(parseCoreCalculationSave(input({ description: ' '.repeat(600000) + 'Text' + ' '.repeat(10) })).description).toBe('Text')
  })
})