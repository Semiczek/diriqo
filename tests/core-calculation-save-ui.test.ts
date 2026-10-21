import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { csDictionary } from '../lib/i18n/dictionaries/cs'
import { parseCoreCalculationCreate } from '../lib/core-calculation-save'
import { calculationPayloadItems, calculationReceiptMatches, calculationSaveStorageKey, emptyCalculationItem, readPendingCalculationSave } from '../components/calculation-save-state'

// Actual rendered form handlers with deterministic hooks; local UI-state proof, not browser E2E.
const hooks = vi.hoisted(() => {
  let slots: unknown[] = [], cursor = 0
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  let queued: Array<() => void> = []
  return {
    reset() { effects.forEach(effect => effect.cleanup?.()); effects.clear(); slots = []; cursor = 0; queued = [] },
    render<T>(component: () => T) {
      cursor = 0; let tree = component()
      const work = queued; queued = []; work.forEach(effect => effect())
      if (work.length) { cursor = 0; tree = component() }
      return tree
    },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(slots[index]) : value }]
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useEffect(run: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = effects.get(index)
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) queued.push(() => {
        previous?.cleanup?.(); const cleanup = run(); effects.set(index, { deps, cleanup })
      })
    },
  }
})
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), push: vi.fn(), refresh: vi.fn(), fetch: vi.fn(), active: vi.fn(), supabase: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks, useLayoutEffect: hooks.useEffect, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }), redirect: vi.fn() }))
vi.mock('@/app/business-actions', () => ({ createCalculationAction: mocks.create, updateCalculationAction: mocks.update }))
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ dictionary: csDictionary }) }))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.active }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.supabase }))
vi.mock('@/lib/i18n/server', () => ({ getRequestDictionary: async () => csDictionary }))
vi.mock('@/components/DashboardShell', () => ({ default: 'main' }))
import CalculationCreateForm from '../components/CalculationCreateForm'
import CalculationEditForm from '../components/CalculationEditForm'
import NewStandaloneCalculationPage from '../app/kalkulace/nova/bez-zakaznika/page'
import NewCalculationStartPage from '../app/kalkulace/nova/page'
import NewCustomerCalculationPage from '../app/customers/[customerId]/calculations/new/page'
import EditGlobalCalculationPage from '../app/kalkulace/[calculationId]/edit/page'
import EditCustomerCalculationPage from '../app/customers/[customerId]/calculations/[calculationId]/edit/page'

const companyId = '11111111-1111-4111-8111-111111111111', profileId = '22222222-2222-4222-8222-222222222222'
const customerId = '33333333-3333-4333-8333-333333333333', calculationId = '44444444-4444-4444-8444-444444444444'
const otherCompany = '55555555-5555-4555-8555-555555555555'
const props = { companyId, profileId, customerId, customerName: 'Synthetic customer', cancelHref: '/customers' }
const key = calculationSaveStorageKey(props)
let store: Map<string, string>
function elements(value: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!React.isValidElement<Record<string, unknown>>(value)) return []
  return [{ type: value.type, props: value.props }, ...elements(value.props.children)]
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join(' ')
  return React.isValidElement<{ children?: unknown }>(value) ? text(value.props.children) : ''
}
function one(tree: unknown, predicate: (node: ReturnType<typeof elements>[number]) => boolean) {
  const result = elements(tree).find(predicate); expect(result).toBeDefined(); return result!
}
const render = (overrides: Partial<Parameters<typeof CalculationCreateForm>[0]> = {}) => hooks.render(() => CalculationCreateForm({ ...props, ...overrides }))
const change = (tree: unknown, id: string, value: string) => (one(tree, node => node.props.id === id).props.onChange as (event: unknown) => void)({ target: { value } })
const submit = (tree: unknown) => (one(tree, node => node.type === 'form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
const locked = (tree: unknown) => one(tree, node => node.type === 'fieldset').props.disabled
function fill() {
  const tree = render()
  change(tree, 'calculation-title', 'Synthetic zero price')
  change(tree, 'calculation-date', '2026-10-21')
  change(tree, 'calculation-item-0-name', 'Customer zero'); change(tree, 'calculation-item-0-unitPrice', '0')
  change(tree, 'calculation-item-1-name', 'Internal cost'); change(tree, 'calculation-item-1-unitCost', '1')
  return render()
}
function receipt(input: { companyId: string; operationId: string }, revision = '1') {
  return { companyId: input.companyId, operationId: input.operationId, calculationId, revision, replayed: false }
}
beforeEach(() => {
  vi.resetAllMocks(); hooks.reset(); store = new Map()
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } })
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ companyId, profileId }) })
  mocks.create.mockImplementation(async input => ({ ok: true, data: receipt(input) }))
  mocks.active.mockResolvedValue({ companyId, profileId, role: 'company_admin' })
})
afterEach(() => { hooks.reset(); vi.unstubAllGlobals() })

describe('atomic calculation real UI handlers', () => {
  it('persists before dispatch, blocks same-render double submit and saves customer zero plus cost one', async () => {
    let finish!: (value: unknown) => void
    mocks.create.mockImplementation(input => {
      expect(JSON.parse(store.get(key)!).payload).toEqual(input)
      return new Promise(resolve => { finish = resolve })
    })
    const tree = fill(); const first = submit(tree); await submit(tree)
    expect(mocks.create).toHaveBeenCalledOnce(); expect(locked(render())).toBe(true)
    const input = mocks.create.mock.calls[0][0]
    expect(input.items.map((item: { unitPrice: string; unitCost: string }) => [item.unitPrice, item.unitCost])).toEqual([['0.00', '0.00'], ['0.00', '1.00']])
    expect(input).toMatchObject({ companyId, profileId, customerId, currency: 'CZK' })
    expect(input).not.toHaveProperty('subtotalPrice')
    expect(text(render())).toContain('-1,00')
    finish({ ok: true, data: receipt(input) }); await first
    expect(store.has(key)).toBe(false)
    expect(mocks.push).toHaveBeenCalledWith('/customers/' + customerId + '/calculations/' + calculationId)
    await submit(tree); expect(mocks.create).toHaveBeenCalledOnce()
  })
  it('replays identical payload and operation after transport loss, reload and a later definitive forbidden', async () => {
    mocks.create.mockRejectedValueOnce(new Error('lost after commit'))
    await submit(fill()); const original = mocks.create.mock.calls[0][0]
    expect(locked(render())).toBe(true)
    hooks.reset(); const restored = render({ initialTitle: 'different defaults' })
    expect(one(restored, node => node.props.id === 'calculation-title').props.value).toBe(original.title)
    mocks.create.mockResolvedValueOnce({ ok: false, code: 'forbidden', uncertain: false, error: 'Access changed' })
    await submit(restored); expect(store.has(key)).toBe(true); expect(locked(render())).toBe(true)
    await submit(render())
    expect(mocks.create.mock.calls.map(call => call[0])).toEqual([original, original, original])
  })
  it.each([undefined, { ok: true, data: {} }, { ok: false, error: 'Missing uncertainty flag' }, { ok: false, code: 'unknown', uncertain: false, error: 'Contradictory' }])('keeps malformed result %j pending', async result => {
    mocks.create.mockResolvedValueOnce(result); await submit(fill())
    expect(locked(render())).toBe(true); expect(store.has(key)).toBe(true); expect(mocks.push).not.toHaveBeenCalled()
  })
  it('rejects a success with the wrong revision and only unlocks a definite first rejection', async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, code: 'validation', uncertain: false, error: 'Invalid' })
    await submit(fill()); expect(store.size).toBe(0); expect(locked(render())).toBe(false)
    mocks.create.mockImplementationOnce(async input => ({ ok: true, data: receipt(input, '2') }))
    await submit(render()); expect(store.has(key)).toBe(true); expect(locked(render())).toBe(true); expect(mocks.push).not.toHaveBeenCalled()
  })
  it('does not replace malformed storage, wrong tenant payload or a storage failure', async () => {
    store.set(key, '{invalid'); await submit(render()); expect(mocks.create).not.toHaveBeenCalled(); expect(store.get(key)).toBe('{invalid')
    hooks.reset(); store.clear()
    const tree = fill()
    window.sessionStorage.setItem = () => { throw new Error('blocked') }
    await submit(tree); await submit(tree)
    expect(mocks.create).not.toHaveBeenCalled(); expect(locked(render())).toBe(true)
  })
  it('retains a confirmed receipt across reload when context lookup fails, without another save', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('network'))
    await submit(fill()); expect(mocks.push).not.toHaveBeenCalled()
    expect(JSON.parse(store.get(key)!).receipt.calculationId).toBe(calculationId)
    hooks.reset(); const tree = render(); expect(text(tree)).toContain('Kalkulace je uložená.')
    await submit(tree); expect(mocks.create).toHaveBeenCalledOnce()
    const open = one(tree, node => node.type === 'button' && text(node.props.children).includes('Ověřit firmu'))
    ;(open.props.onClick as () => void)(); await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledOnce())
    expect(store.size).toBe(0)
  })
  it.each([{ companyId: otherCompany, profileId }, { companyId }, { companyId, profileId: customerId }])('does not navigate under changed or incomplete current scope %j', async active => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => active })
    await submit(fill()); expect(mocks.push).not.toHaveBeenCalled(); expect(text(render())).toContain('Kalkulace je uložená')
    expect(JSON.parse(store.get(key)!).receipt).toBeDefined()
  })
  it('ignores a late response after in-place company change and retains A pending separately', async () => {
    let finish!: (value: unknown) => void
    mocks.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const flight = submit(fill()); const original = mocks.create.mock.calls[0][0]
    expect(locked(render({ companyId: otherCompany }))).toBe(true)
    finish({ ok: true, data: receipt(original) }); await flight
    expect(mocks.push).not.toHaveBeenCalled(); expect(store.has(key)).toBe(true)
    hooks.reset(); expect(locked(render({ companyId: otherCompany }))).toBe(false)
  })
  it.each([['calculation-item-0-unitPrice', ''], ['calculation-item-1-unitCost', ''], ['calculation-item-0-unitPrice', '-1'], ['calculation-item-0-quantity', '1.001']])('rejects invalid %s=%s without dropping a row', async (id, value) => {
    const tree = fill(); change(tree, id, value); await submit(render())
    expect(mocks.create).not.toHaveBeenCalled(); expect(store.size).toBe(0)
  })
  it('does not silently drop a named or partial row with missing numeric input', async () => {
    let tree = fill()
    const add = one(tree, node => node.props['data-tour'] === 'calculation-add-cost-item')
    ;(add.props.onClick as () => void)(); tree = render(); change(tree, 'calculation-item-2-description', 'Partial material')
    await submit(render()); expect(mocks.create).not.toHaveBeenCalled()
  })
  it('uses exact rounded row totals and preserves all six item types', async () => {
    const types = ['customer', 'labor', 'material', 'rental', 'transport', 'accommodation']
    const initialValues = { title: 'All types', description: '', status: 'ready' as const, calculationDate: '2026-10-21', internalNote: 'Keep note', currency: 'CZK',
      items: types.map(itemType => ({ itemType, name: itemType, description: 'Original', quantity: '0.05', unit: 'ks', unitCost: itemType === 'customer' ? '0' : '0.10', unitPrice: itemType === 'customer' ? '0.10' : '0', vatRate: '21', note: 'Preserved' })) }
    const editProps = { ...props, calculationId, expectedRevision: '9007199254740993', detailHref: '/kalkulace/' + calculationId, initialValues }
    const wrapper = CalculationEditForm(editProps)
    const editorProps = wrapper.props as Parameters<typeof CalculationCreateForm>[0]
    const tree = hooks.render(() => CalculationCreateForm(editorProps))
    mocks.update.mockImplementation(async (_id, input) => ({ ok: true, data: receipt(input, '9007199254740994') }))
    await submit(tree)
    expect(mocks.update).toHaveBeenCalledOnce()
    const input = mocks.update.mock.calls[0][1]
    expect(input.expectedRevision).toBe('9007199254740993'); expect(input.items.map((item: { itemType: string }) => item.itemType)).toEqual(types)
    expect(input.items.every((item: { note: string }) => item.note === 'Preserved')).toBe(true)
    expect(text(tree)).toContain('-0,04')
  })
  it('does not pair unsaved old values with a newer revision delivered by a server refresh', async () => {
    const edit = { calculationId, expectedRevision: '1', detailHref: '/kalkulace/' + calculationId,
      initialValues: { title: 'Initial revision one', description: '', status: 'draft' as const, calculationDate: '2026-10-21', internalNote: '', currency: 'CZK',
        items: [{ itemType: 'customer', name: 'Original item', description: null, quantity: '1', unit: 'ks', unitCost: '0', unitPrice: '0', vatRate: '0', note: null }] } }
    let tree = render({ edit }); change(tree, 'calculation-title', 'Unsaved edit from revision one')
    tree = render({ edit: { ...edit, expectedRevision: '2', initialValues: { ...edit.initialValues, title: 'Changed by another user' } } })
    mocks.update.mockResolvedValueOnce({ ok: false, error: 'Kalkulaci mezitím někdo změnil.', code: 'conflict', uncertain: false })
    await submit(tree)
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ title: 'Unsaved edit from revision one', expectedRevision: '1' })
    expect(mocks.push).not.toHaveBeenCalled(); expect(store.size).toBe(0)
    expect(text(render({ edit }))).toContain('Kalkulaci mezitím někdo změnil.')
  })
  it('retries an edit with the original expected revision after reload, even when server defaults changed', async () => {
    const edit = { calculationId, expectedRevision: '1', detailHref: '/kalkulace/' + calculationId,
      initialValues: { title: 'Original edit', description: 'Before', status: 'draft' as const, calculationDate: '2026-10-21', internalNote: 'Original note', currency: 'CZK',
        items: [{ itemType: 'customer', name: 'Zero', description: null, quantity: '1', unit: 'ks', unitCost: '0', unitPrice: '0', vatRate: '0', note: null }] } }
    mocks.update.mockRejectedValueOnce(new Error('unknown commit'))
    await submit(render({ edit })); const original = mocks.update.mock.calls[0][1]
    hooks.reset()
    const changed = { ...edit, expectedRevision: '2', initialValues: { ...edit.initialValues, title: 'New default' } }
    const tree = render({ edit: changed })
    expect(one(tree, node => node.props.id === 'calculation-title').props.value).toBe('Original edit')
    mocks.update.mockImplementation(async (_id, input) => ({ ok: true, data: { ...receipt(input, '2'), replayed: true } }))
    await submit(tree)
    expect(mocks.update.mock.calls.map(call => call[1])).toEqual([original, original])
    expect(original.expectedRevision).toBe('1'); expect(mocks.create).not.toHaveBeenCalled()
  })
  it('renders historical null type/VAT as unknown and requires explicit resolution without resetting other values', async () => {
    const edit = { calculationId, expectedRevision: '1', detailHref: '/kalkulace/' + calculationId,
      initialValues: { title: 'Legacy', description: '', status: 'draft' as const, calculationDate: '2026-10-21', internalNote: '', currency: 'CZK',
        items: [{ itemType: null, name: 'Legacy item', description: 'History', quantity: '1', unit: 'ks', unitCost: '1', unitPrice: '0', vatRate: null, note: 'Keep' }] } }
    let tree = render({ edit })
    expect(text(tree)).toContain('Původní typ nebo DPH'); expect(one(tree, n => n.props.id === 'calculation-item-0-vatRate').props.value).toBe('')
    await submit(tree); expect(mocks.update).not.toHaveBeenCalled()
    change(tree, 'calculation-item-0-itemType', 'transport'); change(tree, 'calculation-item-0-vatRate', '0')
    tree = render({ edit }); mocks.update.mockImplementation(async (_id, input) => ({ ok: true, data: receipt(input, '2') }))
    await submit(tree)
    expect(mocks.update.mock.calls[0][1].items[0]).toMatchObject({ itemType: 'transport', vatRate: '0.00', unitCost: '1.00', description: 'History', note: 'Keep' })
  })
})

describe('pending calculation validation and server page scope', () => {
  it('separates company/profile/customer/standalone/edit and rejects a valid payload with mismatched identity', () => {
    expect(new Set([key, calculationSaveStorageKey({ ...props, companyId: otherCompany }), calculationSaveStorageKey({ ...props, profileId: customerId }),
      calculationSaveStorageKey({ ...props, customerId: null }), calculationSaveStorageKey({ ...props, calculationId })]).size).toBe(5)
    const payload = parseCoreCalculationCreate({ companyId, profileId, customerId, operationId: calculationId, title: 'One', description: null, status: 'draft', calculationDate: '2026-10-21', internalNote: null, currency: 'CZK',
      items: [{ itemType: 'customer', name: 'Item', description: null, quantity: '1', unit: null, unitCost: '0', unitPrice: '0', vatRate: '21', note: null }] })
    expect(() => readPendingCalculationSave(JSON.stringify({ version: 1, scope: props, payload: { ...payload, companyId: otherCompany } }), props)).toThrow()
  })
  it('only omits pristine new rows and never omits persisted or explicit-zero rows', () => {
    const row = emptyCalculationItem('material', 'id')
    expect(calculationPayloadItems([row])).toEqual([])
    expect(calculationPayloadItems([{ ...row, unitCost: '0' }])).toHaveLength(1)
    expect(calculationPayloadItems([{ ...row, quantity: '' }])).toHaveLength(1)
    expect(calculationPayloadItems([{ ...row, persisted: true }])).toHaveLength(1)
    expect(calculationReceiptMatches({}, {} as never)).toBe(false)
    expect(() => readPendingCalculationSave('{}', props)).toThrow()
  })
  it('keeps standalone lead prefill while querying only the active company and using the verified profile', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: {
      id: 'lead', name: 'Contact', company_name: 'Synthetic lead', email: 'test@example.invalid', phone: '000', service_slug: 'cleaning', message: 'Preserve request',
    }, error: null }) }
    mocks.supabase.mockResolvedValue({ from: vi.fn().mockReturnValue(query) })
    const tree = await NewStandaloneCalculationPage({ searchParams: Promise.resolve({ leadId: 'lead' }) })
    const form = one(tree, node => node.type === CalculationCreateForm)
    expect(form.props).toMatchObject({ companyId, profileId, initialTitle: 'Kalkulace - Synthetic lead', initialDescription: 'Preserve request' })
    expect(form.props.initialInternalNote).toContain('test@example.invalid'); expect(query.eq).toHaveBeenCalledWith('company_id', companyId)
    expect(mocks.active).toHaveBeenCalledWith({ allowedRoles: ['company_admin', 'super_admin'] })
  })
  it('scopes both customer chooser and customer create page and denies unauthorized roles before data queries', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: { id: customerId, name: 'Customer', company_id: companyId }, error: null }) }
    mocks.supabase.mockResolvedValue({ from: vi.fn().mockReturnValue(query) })
    await NewCalculationStartPage(); expect(query.eq).toHaveBeenCalledWith('company_id', companyId)
    const tree = await NewCustomerCalculationPage({ params: Promise.resolve({ customerId }) })
    expect(one(tree, node => node.type === CalculationCreateForm).props).toMatchObject({ companyId, profileId, customerId })
    mocks.active.mockResolvedValue(null); mocks.supabase.mockClear(); await NewCalculationStartPage()
    expect(mocks.supabase).not.toHaveBeenCalled()
  })
  it('reads edit revisions as text and preserves every historical field under an explicit parent company filter', async () => {
    const header = { id: calculationId, company_id: companyId, customer_id: customerId, revision: '9007199254740993', currency: 'CZK',
      title: 'Historical', description: 'Full', status: 'ready', calculation_date: '2026-10-21', internal_note: 'Internal', customers: { id: customerId, name: 'Customer' } }
    const row = { item_type: null, name: 'Original', description: 'Legacy description', quantity: '2.10', unit: 'h', unit_cost: '3.20', unit_price: '0.00', vat_rate: null, note: 'Historical note' }
    const headerQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: header, error: null }) }
    const itemQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: [row], error: null })) } }
    mocks.supabase.mockResolvedValue({ from: vi.fn((table: string) => table === 'calculations' ? headerQuery : itemQuery) })
    for (const page of [EditGlobalCalculationPage, EditCustomerCalculationPage]) {
      const tree = await page({ params: Promise.resolve({ calculationId, customerId }) })
      const form = one(tree, node => node.type === CalculationEditForm)
      expect(form.props).toMatchObject({ companyId, profileId, calculationId, expectedRevision: '9007199254740993',
        initialValues: { currency: 'CZK', internalNote: 'Internal', items: [{ itemType: null, quantity: '2.10', unitCost: '3.20', unitPrice: '0.00', vatRate: null, note: 'Historical note' }] } })
    }
    expect(headerQuery.select.mock.calls[0][0]).toContain('revision::text')
    expect(headerQuery.eq).toHaveBeenCalledWith('company_id', companyId)
    expect(itemQuery.eq).toHaveBeenCalledWith('calculations.company_id', companyId)
  })

})
