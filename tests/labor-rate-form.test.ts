// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaborRateListDto, LaborRateScheduleInput } from '../lib/labor-history'

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement('a', { href }, children) }))
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ locale: 'cs' }) }))
vi.mock('@/app/workers/[workerId]/rates/actions', () => ({ scheduleWorkerRateAction: mocks.save }))
import WorkerRatesClient from '../app/workers/[workerId]/rates/WorkerRatesClient'

const companyId = '11111111-1111-4111-8111-111111111111'
const actorProfileId = '22222222-2222-4222-8222-222222222222'
const profileId = '33333333-3333-4333-8333-333333333333'
const otherCompanyId = '44444444-4444-4444-8444-444444444444'
const storageKey = `diriqo:labor-rate:v1:${companyId}:${actorProfileId}:${profileId}`
const schedule: LaborRateListDto = { companyId, profileId, revision: '0', currency: 'CZK', companyName: 'Firma A', profileName: 'Test Pracovník', rates: [] }
let root: Root
let container: HTMLDivElement
function success(command: LaborRateScheduleInput) {
  return { ok: true, data: { companyId: command.companyId, profileId: command.profileId, operationId: command.operationId, revision: '1', rateId: '55555555-5555-4555-8555-555555555555' } }
}
async function mount(next = schedule, key = `${next.companyId}:${next.revision}`) {
  await act(async () => { root.render(createElement(WorkerRatesClient, { key, schedule: next, actorProfileId })) })
}
function button(text: string) {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent === text)
  expect(found).toBeDefined()
  return found!
}
function fill(amount = '200') {
  ;(container.querySelector('[name="effectiveFrom"]') as HTMLInputElement).value = '2026-11-01'
  ;(container.querySelector('[name="hourlyRate"]') as HTMLInputElement).value = amount
  ;(container.querySelector('[name="reason"]') as HTMLTextAreaElement).value = 'Smluvená změna od listopadu'
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}
async function click(text: string) { await act(async () => { button(text).click() }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  mocks.save.mockReset().mockImplementation(async command => success(command))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('Rate schedule form with real React and browser storage', () => {
  it('saves explicit zero with pinned company, actor, worker and version', async () => {
    await mount(); fill('0'); await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined()
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ companyId, actorProfileId, profileId, expectedRevision: '0', hourlyRate: '0.00', effectiveFrom: '2026-11-01', currency: 'CZK' })
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(container.textContent).toContain('Sazba byla uložena.')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('persists an unknown result and replays the identical operation after a remount', async () => {
    mocks.save.mockRejectedValueOnce(new Error('network failed after commit'))
    await mount(); fill(); await submit()
    const original = mocks.save.mock.calls[0][0]
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original)
    await mount(schedule, 'restored')
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    await click('Ověřit stejné uložení')
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1][0]).toEqual(original)
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('does not dispatch a second write on duplicate submit', async () => {
    let finish!: (value: ReturnType<typeof success>) => void
    mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount(); fill(); await submit(); await submit()
    expect(mocks.save).toHaveBeenCalledOnce()
    await act(async () => { finish(success(mocks.save.mock.calls[0][0])) })
  })

  it('blocks mutation when the pending operation cannot be stored', async () => {
    await mount(); fill()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied') })
    await submit()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Povolte úložiště')
  })

  it('does not replay malformed or foreign saved commands', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ companyId: otherCompanyId }))
    await mount()
    expect(container.textContent).toContain('Uložený požadavek nelze ověřit')
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('retains an unverified receipt instead of treating another company response as saved', async () => {
    mocks.save.mockImplementation(async command => ({ ...success(command), data: { ...success(command).data, companyId: otherCompanyId } }))
    await mount(); fill(); await submit()
    expect(sessionStorage.getItem(storageKey)).not.toBeNull()
    expect(container.textContent).not.toContain('Sazba byla uložena.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps entered values after a confirmed stale revision rejection', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Záznam mezitím někdo změnil.', code: 'conflict', uncertain: false })
    await mount(); fill(); await submit()
    expect((container.querySelector('[name="hourlyRate"]') as HTMLInputElement).value).toBe('200')
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(button('Načíst aktuální historii')).toBeDefined()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(container.textContent).toContain('Záznam mezitím někdo změnil.')
  })

  it('preserves an unresolved operation when a later retry is denied', async () => {
    mocks.save.mockRejectedValueOnce(new Error('unknown'))
    await mount(); fill(); await submit()
    const stored = sessionStorage.getItem(storageKey)
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Přístup odebrán', code: 'forbidden', uncertain: false })
    await click('Ověřit stejné uložení')
    await mount(structuredClone(schedule))
    expect(sessionStorage.getItem(storageKey)).toBe(stored)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(container.textContent).toContain('2026-11-01')
    expect(container.textContent).toContain('200.00 CZK')
    expect(container.textContent).toContain('Test Pracovník')
  })

  it('restores a contractor conflict draft under the refreshed revision without changing its cost type', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Conflict', code: 'conflict', uncertain: false })
    await mount(); fill()
    ;(container.querySelector('[name="workerType"]') as HTMLSelectElement).value = 'contractor'
    await submit()
    const rejected = mocks.save.mock.calls[0][0]
    await click('Načíst aktuální historii')
    await mount({ ...schedule, revision: '1' })
    expect((container.querySelector('[name="hourlyRate"]') as HTMLInputElement).value).toBe('200.00')
    expect((container.querySelector('[name="workerType"]') as HTMLSelectElement).value).toBe('contractor')
    await submit()
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: '1', hourlyRate: '200.00', workerType: 'contractor' })
    expect(mocks.save.mock.calls[1][0].operationId).not.toBe(rejected.operationId)
  })

  it('unlocks a rejected effective date only after a requested fresh server read at the same revision', async () => {
    const current = { ...schedule, revision: '1' }
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Date already exists', code: 'conflict', uncertain: false })
    await mount(current); fill(); await submit()
    const rejected = mocks.save.mock.calls[0][0]
    // A refresh alone is not evidence that server state has been read again.
    const beforeRefresh = structuredClone(current)
    await mount(beforeRefresh)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    await click('Načíst aktuální historii')
    await mount(beforeRefresh)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(mocks.save).toHaveBeenCalledOnce()
    await mount(structuredClone(current))
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
    expect((container.querySelector('[name="hourlyRate"]') as HTMLInputElement).value).toBe('200')
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(mocks.save).toHaveBeenCalledOnce()
    ;(container.querySelector('[name="effectiveFrom"]') as HTMLInputElement).value = '2026-11-02'
    await submit()
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: '1', effectiveFrom: '2026-11-02', hourlyRate: '200.00' })
    expect(mocks.save.mock.calls[1][0].operationId).not.toBe(rejected.operationId)
  })

  it('ignores a late result after the company view has been replaced', async () => {
    let finish!: (value: ReturnType<typeof success>) => void
    mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount(); fill(); await submit()
    const original = mocks.save.mock.calls[0][0]
    await mount({ ...schedule, companyId: otherCompanyId })
    await act(async () => { finish(success(original)) })
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Sazba byla uložena.')
    expect(sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  it('starts the refreshed form from the newly loaded server revision', async () => {
    await mount(); fill(); await submit()
    await mount({ ...schedule, revision: '1' })
    fill('250'); await submit()
    expect(mocks.save.mock.calls[1][0].expectedRevision).toBe('1')
    expect(mocks.save.mock.calls[1][0].operationId).not.toBe(mocks.save.mock.calls[0][0].operationId)
  })
})
