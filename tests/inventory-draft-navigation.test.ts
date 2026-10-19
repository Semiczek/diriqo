import { describe, expect, it, vi } from 'vitest'
import { createInventoryDraftGuard, inventoryLinkLeavesDraft } from '../lib/inventory/draft-navigation'

const href = 'https://app.example.invalid/inventory?tab=stock&warehouse=warehouse-a'
const click = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

describe('inventory draft navigation', () => {
  it('keeps a modified receipt when the user cancels leaving or changing warehouses', () => {
    const confirm = vi.fn(() => false)
    const guard = createInventoryDraftGuard(confirm)
    guard.markDirty()
    expect(guard.discard()).toBe(false)
    expect(guard.shouldWarn()).toBe(true)
    const event = { preventDefault: vi.fn(), returnValue: 'unchanged' }
    guard.beforeUnload(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
    expect(confirm).toHaveBeenCalledOnce()
  })
  it('allows confirmed discard once, without a second unload prompt', () => {
    const confirm = vi.fn(() => true)
    const guard = createInventoryDraftGuard(confirm)
    guard.markDirty()
    expect(guard.discard()).toBe(true)
    const event = { preventDefault: vi.fn(), returnValue: 'unchanged' }
    guard.beforeUnload(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(guard.discard()).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
  })
  it('blocks leaving an in-flight save without pretending its outcome is known', () => {
    let saving = true
    const confirm = vi.fn(() => true)
    const guard = createInventoryDraftGuard(confirm)
    expect(guard.discard(saving)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    saving = false
    expect(guard.discard(saving)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('successful save clears dirty state without prompting', () => {
    const confirm = vi.fn(() => false)
    const guard = createInventoryDraftGuard(confirm)
    guard.markDirty(); guard.clear()
    expect(guard.discard()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
  it.each([
    '/inventory?tab=documents&warehouse=warehouse-a',
    '/inventory?tab=stock&warehouse=warehouse-b',
    '/jobs',
    'https://another.example.invalid/',
  ])('guards same-tab departure to %s', next => {
    expect(inventoryLinkLeavesDraft({ href: next }, click, href)).toBe(true)
  })
  it.each([
    [{ href: '/jobs', target: '_blank' }, click],
    [{ href: '/jobs' }, { ...click, ctrlKey: true }],
    [{ href: '/jobs' }, { ...click, metaKey: true }],
    [{ href: '/jobs' }, { ...click, shiftKey: true }],
    [{ href: '/jobs' }, { ...click, button: 1 }],
    [{ href: '/jobs' }, { ...click, defaultPrevented: true }],
    [{ href: '/inventory/export?kind=stock', keepDraft: true }, click],
    [{ href: '/download', download: true }, click],
    [{ href: '#workspace-content' }, click],
    [{ href }, click],
    [{ href: 'mailto:test@example.invalid' }, click],
  ])('keeps the draft without a departure prompt for %j', (link, event) => {
    expect(inventoryLinkLeavesDraft(link, event, href)).toBe(false)
  })
})
