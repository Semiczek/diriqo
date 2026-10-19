import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import type { CalendarSnapshot } from '../lib/calendar/types'

// Exercises the real component handlers and rendered props with a small hook
// runtime. This is a local UI-state regression test, not browser or React E2E.
type Slot = { initialized: boolean; value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }
const hooks = vi.hoisted(() => {
  const instances = new Map<string, Slot[]>()
  let active = 'page'
  let cursor = 0
  let effects: Array<() => void> = []
  const next = () => {
    const slots = instances.get(active) ?? []
    instances.set(active, slots)
    return slots[cursor++] ?? (slots[cursor - 1] = { initialized: false })
  }
  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
  return {
    reset() { instances.clear(); cursor = 0; effects = [] },
    render<T>(component: () => T, instance = 'page'): T {
      active = instance; cursor = 0
      const result = component()
      const queued = effects; effects = []
      queued.forEach(effect => effect())
      return result
    },
    useState(initial: unknown) {
      const slot = next()
      if (!slot.initialized) {
        slot.value = typeof initial === 'function' ? (initial as () => unknown)() : initial
        slot.initialized = true
      }
      return [slot.value, (value: unknown) => {
        slot.value = typeof value === 'function' ? (value as (previous: unknown) => unknown)(slot.value) : value
      }]
    },
    useRef(initial: unknown) {
      const slot = next()
      if (!slot.initialized) { slot.value = { current: initial }; slot.initialized = true }
      return slot.value
    },
    useMemo(calculate: () => unknown, deps?: readonly unknown[]) {
      const slot = next()
      if (!slot.initialized || changed(slot.deps, deps)) { slot.value = calculate(); slot.deps = deps; slot.initialized = true }
      return slot.value
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = next()
      if (!slot.initialized || changed(slot.deps, deps)) {
        slot.initialized = true; slot.deps = deps
        effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined })
      }
    },
    useEffectEvent(callback: (...args: unknown[]) => unknown) {
      const slot = next()
      slot.value = callback
      return (...args: unknown[]) => (slot.value as typeof callback)(...args)
    },
  }
})
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn(), confirm: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, ...hooks, useCallback: (callback: unknown, deps?: readonly unknown[]) => hooks.useMemo(() => callback, deps), startTransition: (callback: () => void) => callback() }
})
vi.mock('next/navigation', () => ({ useParams: () => ({ eventId: 'event-a' }), useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('@/components/DashboardShell', () => ({ default: 'DashboardShell' }))
vi.mock('@/components/I18nProvider', async () => {
  const { csDictionary } = await import('../lib/i18n/dictionaries/cs')
  return { useI18n: () => ({ dictionary: csDictionary, locale: 'cs' }) }
})
vi.mock('@/app/calendar/actions', () => ({ readCalendarEditorAction: mocks.read, createCalendarEventAction: mocks.create, updateCalendarEventAction: mocks.update, deleteCalendarEventAction: mocks.remove }))

import DetailPage from '../app/calendar/events/[eventId]/page'
import NewPage from '../app/calendar/new/page'
import DangerZone from '../components/CalendarEventDangerZone'
import { csDictionary } from '../lib/i18n/dictionaries/cs'

type Node = { type: unknown; props: Record<string, unknown> }
const t = csDictionary.calendar.eventDetail
const saved: CalendarSnapshot = {
  event: { id: 'event-a', company_id: 'company-a', title: 'Original meeting', description: 'Original note', start_at: '2026-10-19T07:00:00Z', end_at: '2026-10-19T08:00:00Z', job_id: null, revision: '4' },
  assigned_profile_ids: ['alice'],
}
const newer: CalendarSnapshot = {
  event: { ...saved.event, title: 'Saved by another manager', start_at: '2026-10-20T12:00:00Z', end_at: '2026-10-20T13:00:00Z', revision: '5' },
  assigned_profile_ids: ['bob'],
}
function editor(snapshot: CalendarSnapshot | null = saved) {
  return { ok: true, data: { companyId: 'company-a', companyName: 'Active company', jobs: [], profiles: [{ id: 'alice', full_name: 'Alice' }, { id: 'bob', full_name: 'Bob' }], snapshot } }
}
function success(snapshot: CalendarSnapshot) {
  return { ok: true, eventId: snapshot.event.id, event: snapshot.event, assignedProfileIds: snapshot.assigned_profile_ids }
}
function elements(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement<Record<string, unknown>>(node)) return []
  return [{ type: node.type, props: node.props }, ...elements(node.props.children)]
}
function one(tree: unknown, predicate: (node: Node) => boolean): Node {
  const node = elements(tree).find(predicate)
  expect(node).toBeDefined()
  return node!
}
function input(tree: unknown, id: string) { return one(tree, node => node.props.id === id) }
function change(tree: unknown, id: string, value: string) { (input(tree, id).props.onChange as (event: unknown) => void)({ target: { value } }) }
function submit(tree: unknown) { (one(tree, node => node.type === 'form').props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }) }
function click(node: Node) { (node.props.onClick as () => void)() }
function saveButton(tree: unknown) { return one(tree, node => node.type === 'button' && node.props.type === 'submit') }
function danger(tree: unknown) { return one(tree, node => node.type === DangerZone) }
function renderDanger(tree: unknown) {
  return hooks.render(() => DangerZone(danger(tree).props as React.ComponentProps<typeof DangerZone>), 'danger')
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve() }
async function load(component = DetailPage) {
  hooks.render(component)
  await settle()
  return hooks.render(component)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks(); hooks.reset()
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', { confirm: mocks.confirm })
  mocks.read.mockResolvedValue(editor())
  mocks.confirm.mockReturnValue(true)
})

describe('calendar editor real handlers: draft, revision and uncertain outcomes', () => {
  it('keeps every draft field and its base revision after conflict, then requires confirmation before loading the winner', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'conflict', error: 'stale', current: newer })
    let tree = await load()
    change(tree, 'calendar-title', 'My unsaved title')
    change(tree, 'calendar-description', 'My unsaved note')
    change(tree, 'calendar-start', '2026-10-21T09:30')
    change(tree, 'calendar-end', '2026-10-21T10:30')
    const bob = one(tree, node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false)
    ;(bob.props.onChange as () => void)()
    tree = hooks.render(DetailPage)
    submit(tree); await settle(); tree = hooks.render(DetailPage)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', expectedRevision: '4', startAt: new Date('2026-10-21T09:30').toISOString(), selectedProfileIds: ['alice', 'bob'] }))
    expect(input(tree, 'calendar-title').props.value).toBe('My unsaved title')
    expect(input(tree, 'calendar-description').props.value).toBe('My unsaved note')
    expect(input(tree, 'calendar-start').props.value).toBe('2026-10-21T09:30')
    expect(input(tree, 'calendar-end').props.value).toBe('2026-10-21T10:30')
    expect(elements(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked)).toHaveLength(2)
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(danger(tree).props).toMatchObject({ disabled: true, expectedRevision: '4' })
    expect(JSON.stringify(tree)).toContain(newer.event.title)

    mocks.confirm.mockReturnValue(false)
    click(one(tree, node => node.type === 'button' && node.props.children === t.loadLatest))
    await settle()
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(input(hooks.render(DetailPage), 'calendar-title').props.value).toBe('My unsaved title')

    mocks.confirm.mockReturnValue(true)
    mocks.read.mockResolvedValue(editor(newer))
    click(one(tree, node => node.type === 'button' && node.props.children === t.loadLatest))
    await settle(); tree = hooks.render(DetailPage)
    expect(mocks.confirm).toHaveBeenLastCalledWith(t.confirmLoadLatest)
    expect(input(tree, 'calendar-title').props.value).toBe(newer.event.title)
    expect(saveButton(tree).props.disabled).toBe(false)
    expect(danger(tree).props.expectedRevision).toBe('5')
    mocks.update.mockResolvedValue(success({ ...newer, event: { ...newer.event, revision: '6' } }))
    submit(tree); await settle(); tree = hooks.render(DetailPage)
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: '5' }))
    expect(danger(tree).props.expectedRevision).toBe('6')
  })

  it('leaves the draft and both writes blocked when loading the winner fails', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'conflict', error: 'stale', current: newer })
    let tree = await load()
    change(tree, 'calendar-title', 'Keep this draft'); tree = hooks.render(DetailPage)
    submit(tree); await settle(); tree = hooks.render(DetailPage)
    mocks.read.mockRejectedValue(new Error('network lost'))
    click(one(tree, node => node.type === 'button' && node.props.children === t.loadLatest))
    await settle(); tree = hooks.render(DetailPage)
    expect(input(tree, 'calendar-title').props.value).toBe('Keep this draft')
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(danger(tree).props).toMatchObject({ disabled: true, expectedRevision: '4' })
  })

  it.each(['unknown', 'transport'])('blocks blind retries and preserves the draft after an %s update outcome', async outcome => {
    if (outcome === 'transport') mocks.update.mockRejectedValue(new Error('lost response'))
    else mocks.update.mockResolvedValue({ ok: false, code: 'unknown', error: 'unknown outcome' })
    let tree = await load()
    change(tree, 'calendar-title', 'Uncertain draft'); tree = hooks.render(DetailPage)
    submit(tree); await settle(); tree = hooks.render(DetailPage)
    submit(tree); await settle()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(input(tree, 'calendar-title').props.value).toBe('Uncertain draft')
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(danger(tree).props.disabled).toBe(true)
    expect(JSON.stringify(tree)).toContain(t.uncertainSave)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('blocks repeated submit and delete while update is pending', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    mocks.update.mockReturnValue(pending.promise)
    let tree = await load()
    submit(tree); submit(tree)
    tree = hooks.render(DetailPage)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(saveButton(tree).props.disabled).toBe(true)
    const deletionTree = renderDanger(tree)
    click(one(deletionTree, node => node.type === 'button'))
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    pending.resolve(success(newer)); await settle()
    expect(saveButton(hooks.render(DetailPage)).props.disabled).toBe(false)
  })

  it('blocks update and repeated delete while delete is pending, and sends the same company and revision', async () => {
    const pending = deferred<{ ok: true }>()
    mocks.remove.mockReturnValue(pending.promise)
    let tree = await load()
    const deletionTree = renderDanger(tree)
    const button = one(deletionTree, node => node.type === 'button')
    click(button); click(button)
    tree = hooks.render(DetailPage)
    submit(tree)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ eventId: 'event-a', companyId: 'company-a', expectedRevision: '4' })
    pending.resolve({ ok: true }); await settle()
    expect(mocks.push).toHaveBeenCalledWith('/calendar')
  })

  it('routes delete conflicts through the same preserved draft and revision', async () => {
    mocks.remove.mockResolvedValue({ ok: false, code: 'conflict', error: 'stale', current: newer })
    let tree = await load()
    change(tree, 'calendar-title', 'Do not discard'); tree = hooks.render(DetailPage)
    click(one(renderDanger(tree), node => node.type === 'button'))
    await settle(); tree = hooks.render(DetailPage)
    expect(input(tree, 'calendar-title').props.value).toBe('Do not discard')
    expect(danger(tree).props).toMatchObject({ disabled: true, expectedRevision: '4' })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('preserves the draft and blocks both writes after a lost deletion response', async () => {
    mocks.remove.mockRejectedValue(new Error('delete response lost'))
    let tree = await load()
    change(tree, 'calendar-title', 'Keep after uncertain delete'); tree = hooks.render(DetailPage)
    click(one(renderDanger(tree), node => node.type === 'button'))
    await settle(); tree = hooks.render(DetailPage)
    expect(input(tree, 'calendar-title').props.value).toBe('Keep after uncertain delete')
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(danger(tree).props.disabled).toBe(true)
    expect(JSON.stringify(tree)).toContain(t.uncertainDelete)
    expect(mocks.push).not.toHaveBeenCalled()
    submit(tree)
    click(one(renderDanger(tree), node => node.type === 'button'))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })

  it('lets the user explicitly remove a previously assigned worker who is no longer available', async () => {
    mocks.read.mockResolvedValue(editor({ ...saved, assigned_profile_ids: ['former-worker'] }))
    mocks.update.mockResolvedValue(success({ ...saved, assigned_profile_ids: [] }))
    let tree = await load()
    expect(JSON.stringify(tree)).toContain(t.unavailableWorker)
    const previous = one(tree, node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === true)
    ;(previous.props.onChange as () => void)()
    tree = hooks.render(DetailPage); submit(tree); await settle()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ selectedProfileIds: [] }))
  })

  it('keeps a new-event draft after an unknown creation result and opens reconciliation in another tab', async () => {
    mocks.read.mockResolvedValue(editor(null))
    mocks.create.mockRejectedValue(new Error('response lost'))
    let tree = await load(NewPage)
    change(tree, 'calendar-title', 'New draft')
    change(tree, 'calendar-start', '2026-10-21T09:30')
    change(tree, 'calendar-end', '2026-10-21T10:30')
    tree = hooks.render(NewPage); submit(tree); submit(tree)
    await settle(); tree = hooks.render(NewPage); submit(tree)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', startAt: new Date('2026-10-21T09:30').toISOString() }))
    expect(input(tree, 'calendar-title').props.value).toBe('New draft')
    expect(input(tree, 'calendar-company').props).toMatchObject({ value: 'Active company', readOnly: true })
    expect(saveButton(tree).props.disabled).toBe(true)
    expect(one(tree, node => node.type === 'a' && node.props.href === '/calendar').props.target).toBe('_blank')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
