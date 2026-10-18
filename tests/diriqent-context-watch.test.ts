import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchDiriqentIdentity } from '../lib/diriqent/context-watch'
import { OFFICE_CONTEXT_EVENT } from '../lib/office/client-context'

const identity = { companyId: 'company-a', profileId: 'person-a', role: 'company_admin' }
let browser: EventTarget, documentTarget: EventTarget & { visibilityState: string; hasFocus: () => boolean }
let stop: (() => void) | undefined
const fetchMock = vi.fn(), state = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset(); state.mockReset()
  browser = new EventTarget()
  documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
  vi.stubGlobal('window', browser); vi.stubGlobal('document', documentTarget); vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(Response.json(identity))
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('open conversation access refresh', () => {
  it('uses the existing company-switch event to hide and recheck the current tab', async () => {
    stop = watchDiriqentIdentity(identity, state)
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockResolvedValue(Response.json({ ...identity, companyId: 'company-b' }))
    browser.dispatchEvent(new Event(OFFICE_CONTEXT_EVENT))
    expect(state).toHaveBeenLastCalledWith('checking')
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toHaveBeenLastCalledWith('blocked')
  })
  it('detects a downgrade in an active tab at the next bounded check', async () => {
    stop = watchDiriqentIdentity(identity, state)
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockResolvedValue(Response.json({ ...identity, role: 'manager' }))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state).toHaveBeenLastCalledWith('blocked')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('checks on open and hides before verifying a return to the tab', async () => {
    stop = watchDiriqentIdentity(identity, state)
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toHaveBeenLastCalledWith('ready')
    browser.dispatchEvent(new Event('blur'))
    expect(state).toHaveBeenLastCalledWith('checking')
    fetchMock.mockResolvedValue(Response.json({ ...identity, role: 'manager' }))
    browser.dispatchEvent(new Event('focus'))
    expect(state).toHaveBeenLastCalledWith('checking')
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toHaveBeenLastCalledWith('blocked')
    fetchMock.mockResolvedValue(Response.json(identity))
    browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state).toHaveBeenLastCalledWith('blocked')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('hides on visibility loss without polling hidden tabs', async () => {
    stop = watchDiriqentIdentity(identity, state)
    await vi.advanceTimersByTimeAsync(0)
    documentTarget.visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(state).toHaveBeenLastCalledWith('checking')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('rejects stale successful responses arriving after a role mismatch', async () => {
    let resolveOld!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve }))
    stop = watchDiriqentIdentity(identity, state)
    fetchMock.mockResolvedValue(Response.json({ ...identity, role: 'worker' }))
    browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    resolveOld(Response.json(identity))
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toHaveBeenLastCalledWith('blocked')
    expect(state).not.toHaveBeenCalledWith('ready')
  })
  it('fails closed on a network failure and removes timers and listeners on disposal', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    stop = watchDiriqentIdentity(identity, state)
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toHaveBeenLastCalledWith('blocked')
    stop()
    browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
