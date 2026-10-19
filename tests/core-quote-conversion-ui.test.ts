import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { conversionDates, conversionStorageKey, conversionWorkDays, readPendingConversion } from '../components/quote-conversion-state'

// Real component handlers and rendered props; local UI-state proof, not browser E2E.
const hooks = vi.hoisted(() => {
  let slots: unknown[] = [], cursor = 0
  return {
    reset() { slots = []; cursor = 0 },
    render<T>(component: () => T) { cursor = 0; return component() },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(slots[index]) : value }]
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useEffect() {},
  }
})
const mocks = vi.hoisted(() => ({ action: vi.fn(), fetch: vi.fn(), close: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks }))
vi.mock('@/app/business-actions', () => ({ createJobFromQuoteAction: mocks.action }))
import QuoteConversionDialog from '../components/QuoteConversionDialog'
const companyId = '11111111-1111-4111-8111-111111111111', actorProfileId = '22222222-2222-4222-8222-222222222222'
const quoteId = '33333333-3333-4333-8333-333333333333', jobId = '44444444-4444-4444-8444-444444444444'
const props = { companyId, actorProfileId, quoteId, customerId: null, quoteTitle: 'Synthetic offer', contactEmail: 'test@example.invalid', onClose: mocks.close }
const key = conversionStorageKey(companyId, actorProfileId, quoteId)
let store: Map<string, string>
function elements(value: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!React.isValidElement<Record<string, unknown>>(value)) return []
  return [{ type: value.type, props: value.props }, ...elements(value.props.children)]
}
function one(tree: unknown, predicate: (node: ReturnType<typeof elements>[number]) => boolean) {
  const result = elements(tree).find(predicate)
  expect(result).toBeDefined(); return result!
}
const render = (overrides: Partial<typeof props> = {}) => hooks.render(() => QuoteConversionDialog({ ...props, ...overrides }))
const change = (tree: unknown, id: string, value: string) => (one(tree, node => node.props.id === id).props.onChange as (event: unknown) => void)({ target: { value } })
const check = (node: ReturnType<typeof elements>[number], checked: boolean) => (node.props.onChange as (event: unknown) => void)({ target: { checked } })
const submit = (tree: unknown) => (one(tree, node => node.type === 'form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
const locked = (tree: unknown) => one(tree, node => node.type === 'fieldset').props.disabled
beforeEach(() => {
  vi.resetAllMocks(); hooks.reset(); store = new Map()
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } })
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.fetch.mockResolvedValue({ ok: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('core quote conversion real UI handlers', () => {
  it('blocks a same-render double click and persists scope and payload before dispatch', async () => {
    let done!: (value: unknown) => void
    mocks.action.mockImplementation(() => {
      expect(store.has(key)).toBe(true)
      return new Promise(resolve => { done = resolve })
    })
    const tree = render()
    const first = submit(tree); await submit(tree)
    expect(mocks.action).toHaveBeenCalledOnce()
    expect(locked(render())).toBe(true)
    expect(JSON.parse(store.get(key)!).payload).toEqual(mocks.action.mock.calls[0][0])
    expect(JSON.parse(store.get(key)!).actorProfileId).toBe(actorProfileId)
    done({ ok: true, data: { jobId, created: true } }); await first
    expect(store.has(key)).toBe(false)
  })

  it('preserves unknown payload across reload and forbidden retry, then reconciles without sending email again', async () => {
    mocks.action.mockRejectedValueOnce(new Error('lost response after commit'))
    let tree = render(); change(tree, 'conversion-address', 'Original place'); tree = render()
    await submit(tree)
    const original = mocks.action.mock.calls[0][0]
    expect(locked(render())).toBe(true)
    expect(JSON.stringify(render())).toContain('Ověřit stejný požadavek')
    hooks.reset()
    tree = render({ quoteTitle: 'Changed offer title' })
    expect(locked(tree)).toBe(true)
    expect(one(tree, node => node.props.id === 'conversion-address').props.value).toBe('Original place')
    mocks.action.mockResolvedValueOnce({ ok: false, error: 'Aktivní firma se změnila.', code: 'forbidden', uncertain: false })
    await submit(tree)
    expect(store.has(key)).toBe(true)
    expect(locked(render())).toBe(true)
    mocks.action.mockResolvedValueOnce({ ok: true, data: { jobId, created: false } })
    await submit(render())
    expect(mocks.action.mock.calls.map(call => call[0])).toEqual([original, original, original])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(store.has(key)).toBe(false)
    expect(one(render(), node => node.type === 'a').props.href).toBe(`/jobs/${jobId}`)
  })

  it('retains a first uncertain structured result and unlocks only a definite initial rejection', async () => {
    mocks.action.mockResolvedValueOnce({ ok: false, error: 'Neplatný termín.', code: 'validation', uncertain: false })
    await submit(render())
    expect(store.has(key)).toBe(false); expect(locked(render())).toBe(false)
    mocks.action.mockResolvedValueOnce({ ok: false, error: 'Výsledek neznámý.', code: 'unknown', uncertain: true })
    await submit(render())
    expect(store.has(key)).toBe(true); expect(locked(render())).toBe(true)
  })

  it('keeps confirmed job success when email fails and never offers conversion retry', async () => {
    mocks.action.mockResolvedValue({ ok: true, data: { jobId, created: true } })
    mocks.fetch.mockRejectedValue(new Error('lost mail response'))
    await submit(render())
    const tree = render()
    expect(JSON.stringify(tree)).toContain('Zakázka byla vytvořena.')
    expect(JSON.stringify(tree)).toContain('Zakázka je uložená.')
    expect(elements(tree).some(node => node.type === 'form')).toBe(false)
    expect(mocks.action).toHaveBeenCalledOnce(); expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(store.has(key)).toBe(false)
  })

  it('does not send confirmation for an already existing job on a fresh attempt', async () => {
    mocks.action.mockResolvedValue({ ok: true, data: { jobId, created: false } })
    await submit(render())
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(render())).toContain('Zakázka již existuje.')
  })

  it('sends a single chosen split day explicitly instead of silently changing to single mode', async () => {
    mocks.action.mockResolvedValue({ ok: true, data: { jobId, created: true } })
    let tree = render()
    change(tree, 'conversion-start', '2026-10-19T09:00'); change(tree, 'conversion-end', '2026-10-20T17:00'); tree = render()
    check(one(tree, node => node.type === 'input' && node.props.type === 'checkbox'), true); tree = render()
    const boxes = elements(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')
    check(boxes[2], false); tree = render()
    await submit(tree)
    expect(mocks.action.mock.calls[0][0].splitDays).toHaveLength(1)
    expect(mocks.action.mock.calls[0][0].splitDays[0].startAt).toBe(new Date('2026-10-19T09:00').toISOString())
  })

  it('preserves corrupted saved operations and does not silently create new ones', async () => {
    store.set(key, '{invalid')
    const tree = render(); expect(locked(tree)).toBe(true)
    await submit(tree)
    expect(mocks.action).not.toHaveBeenCalled(); expect(store.get(key)).toBe('{invalid')
  })

  it('keeps another actor or company pending operation separate', async () => {
    mocks.action.mockRejectedValue(new Error('network'))
    await submit(render()); expect(store.has(key)).toBe(true)
    hooks.reset()
    expect(locked(render({ actorProfileId: '55555555-5555-4555-8555-555555555555' }))).toBe(false)
    hooks.reset()
    expect(locked(render({ companyId: '66666666-6666-4666-8666-666666666666' }))).toBe(false)
    expect(store.has(key)).toBe(true)
  })

  it('allows a long standalone job and restores its unchanged pending payload after reload', async () => {
    mocks.action.mockRejectedValueOnce(new Error('lost response'))
    let tree = render()
    change(tree, 'conversion-start', '2026-01-01T09:00'); change(tree, 'conversion-end', '2028-01-01T17:00'); tree = render()
    expect(JSON.stringify(tree)).toContain('Delší termín můžete vytvořit jako jednu zakázku.')
    const splitChoice = one(tree, node => node.type === 'input' && node.props.type === 'checkbox')
    expect(splitChoice.props.disabled).toBe(true)
    expect(one(tree, node => node.type === 'button' && node.props.type === 'submit').props.disabled).toBe(false)
    await submit(tree)
    const payload = mocks.action.mock.calls[0][0]
    expect(payload.splitDays).toEqual([])
    expect(payload.endAt).toBe(new Date('2028-01-01T17:00').toISOString())
    expect(readPendingConversion(store.get(key)!, props)?.payload).toEqual(payload)
    hooks.reset(); tree = render()
    expect(locked(tree)).toBe(true)
    mocks.action.mockResolvedValueOnce({ ok: true, data: { jobId, created: false } })
    await submit(tree)
    expect(mocks.action.mock.calls[1][0]).toEqual(payload)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not retain an unavailable split mode when the range becomes long', async () => {
    mocks.action.mockResolvedValue({ ok: true, data: { jobId, created: true } })
    let tree = render()
    change(tree, 'conversion-start', '2026-10-19T09:00'); change(tree, 'conversion-end', '2026-10-20T17:00'); tree = render()
    check(one(tree, node => node.type === 'input' && node.props.type === 'checkbox'), true); tree = render()
    change(tree, 'conversion-end', '2028-10-20T17:00'); tree = render()
    expect(one(tree, node => node.type === 'input' && node.props.type === 'checkbox').props.checked).toBe(false)
    await submit(tree)
    expect(mocks.action.mock.calls[0][0].splitDays).toEqual([])
  })

  it('validates bounded text before persistence or dispatch and stores normalized input', async () => {
    let tree = render()
    change(tree, 'conversion-description', 'x'.repeat(10001)); tree = render()
    await submit(tree)
    expect(store.size).toBe(0); expect(mocks.action).not.toHaveBeenCalled()
    change(tree, 'conversion-description', '  Clean description  ')
    change(tree, 'conversion-address', '  Clean address  '); tree = render()
    mocks.action.mockRejectedValue(new Error('lost response'))
    await submit(tree)
    const payload = JSON.parse(store.get(key)!).payload
    expect(payload.description).toBe('Clean description'); expect(payload.address).toBe('Clean address')
    expect(mocks.action.mock.calls[0][0]).toEqual(payload)
  })
  it('does not dispatch when durable pending storage is unavailable', async () => {
    vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: () => { throw new Error('Storage blocked') } } })
    await submit(render())
    expect(mocks.action).not.toHaveBeenCalled()
  })
})

describe('bounded local conversion dates', () => {
  it('clips the final overnight occurrence to the parent and skips empty end-day intervals', () => {
    const { start, end } = conversionDates('2026-10-19T22:00', '2026-10-20T06:00')
    const days = conversionWorkDays(start, end)
    expect(days).toHaveLength(1); expect(days[0].endAt).toEqual(end)
    expect(days.every(day => day.startAt >= start && day.endAt <= end && day.endAt > day.startAt)).toBe(true)
  })
  it('keeps multiple overnight occurrences within the parent range', () => {
    const { start, end } = conversionDates('2026-10-19T22:00', '2026-10-22T06:00')
    expect(conversionWorkDays(start, end)).toHaveLength(3)
    expect(conversionWorkDays(start, end).every(day => day.endAt <= end)).toBe(true)
  })
  it.each([['2026-10-19T09:00', '2026-10-19T08:00'], ['2026-02-30T09:00', '2026-03-03T10:00']])('rejects invalid %s to %s', (start, end) => {
    expect(() => conversionDates(start, end)).toThrow()
  })
  it('bounds daily generation without restricting a standalone range', () => {
    const { start, end } = conversionDates('2026-01-01T09:00', '2028-01-01T17:00')
    expect(end > start).toBe(true)
    expect(conversionWorkDays(start, end)).toEqual([])
  })
  it('cannot restore a payload under another identity scope', () => {
    expect(() => readPendingConversion('{}', props)).toThrow()
    expect(conversionStorageKey(companyId, actorProfileId, quoteId)).not.toBe(conversionStorageKey(companyId, 'other-actor', quoteId))
  })
})