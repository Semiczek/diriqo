// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreQuoteWorkspace } from '../lib/core-quote-lifecycle'
import { quoteOperationKey } from '../components/quote-lifecycle-state'

const mocks = vi.hoisted(() => ({
  publish: vi.fn(), open: vi.fn(), decision: vi.fn(), sync: vi.fn(), revoke: vi.fn(),
  archive: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn(), fetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/app/business-actions', () => ({
  publishQuoteAction: mocks.publish, openQuoteRevisionAction: mocks.open,
  recordQuoteDecisionAction: mocks.decision, syncQuotePricingFromCalculationAction: mocks.sync,
  revokeQuotePublicationAction: mocks.revoke, archiveQuoteAction: mocks.archive, deleteQuoteAction: mocks.remove,
}))
vi.mock('../components/QuoteConversionDialog', () => ({ default: () => null }))
vi.mock('../components/QuoteSendForm', () => ({ default: () => null }))
import QuoteActionsPanel from '../components/QuoteActionsPanel'
import { useQuoteOperation } from '../components/useQuoteOperation'

const companyId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const quoteId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'
const otherId = '55555555-5555-4555-8555-555555555555'
const operationId = '66666666-6666-4666-8666-666666666666'
const scope = { companyId, profileId, entityId: quoteId, slot: 'actions' }
const storageKey = quoteOperationKey(scope)
type PublishInput = { companyId: string; profileId: string; quoteId: string; operationId: string; expectedRevision: string }
const command = { kind: 'publish', input: { companyId, profileId, quoteId, operationId, expectedRevision: '1' } }
function receipt(input: PublishInput = command.input) {
  return { companyId, quoteId, operationId: input.operationId, revision: '2', replayed: false,
    versionId, versionNumber: 1, shareToken: 'a'.repeat(64), publishedAt: '2026-10-24T10:00:00Z' }
}
function activeResponse(company = companyId, profile = profileId) {
  return { ok: true, json: async () => ({ companyId: company, profileId: profile }) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
function workspace(revision: string, draftOpen = false): CoreQuoteWorkspace {
  return {
    companyId, quoteId, customerId: null, sourceCalculationId: null, sourceCalculationRevision: null,
    currentCalculationRevision: null, revision, draftOpen, archivedAt: null,
    currentVersionId: draftOpen ? null : versionId, acceptedVersionId: null,
    customerIdentityState: 'captured', customerSnapshot: {},
    draft: { title: 'Offer', quote_date: '2026-10-24', valid_until: null, currency: 'CZK',
      pricing_mode: 'net', discount_amount: '0', customer_note: null, internal_note: null,
      content: {} as CoreQuoteWorkspace['draft']['content'], items: [] },
    versions: draftOpen ? [] : [{ versionId, versionNumber: 1, sourceRevision: '1',
      contentHash: 'a'.repeat(64), publishedAt: '2026-10-24T10:00:00Z', status: 'published',
      acceptedAt: null, rejectedAt: null, shareToken: 'a'.repeat(64), decision: null }],
    responses: [], legacy: null,
  }
}

let container: HTMLDivElement
let root: Root
async function panel(state: CoreQuoteWorkspace, key = state.revision, actor = profileId) {
  await act(async () => {
    root.render(createElement(QuoteActionsPanel, { key, workspace: state, actorProfileId: actor,
      selectedVersionId: state.draftOpen ? null : versionId, selectedKind: state.draftOpen ? 'draft' : 'issued', quoteTitle: 'Offer' }))
  })
}
function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)
  expect(found, label).toBeDefined()
  return found!
}
async function click(label: string) { await act(async () => { button(label).click() }) }
function saveConfirmed() { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, scope, command, receipt: receipt() })) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', mocks.fetch)
  sessionStorage.clear()
  mocks.fetch.mockReset().mockResolvedValue(activeResponse())
  mocks.publish.mockReset().mockImplementation(async (input: PublishInput) => ({ ok: true, data: receipt(input) }))
  mocks.open.mockReset().mockImplementation(async (input: PublishInput) => ({
    ok: true, data: { companyId, quoteId, operationId: input.operationId, revision: String(BigInt(input.expectedRevision) + BigInt(1)), replayed: false },
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('Quote completion with real React mount and refresh lifecycle', () => {
  it('unlocks the fresh panel after a server-action remount and a same-URL confirmed retry', async () => {
    const activeCheck = deferred<ReturnType<typeof activeResponse>>()
    mocks.fetch.mockReturnValueOnce(activeCheck.promise)
    await panel(workspace('1', true))
    await click('Vydat a zpřístupnit verzi')
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).receipt.revision).toBe('2')

    // Next's server-action revalidation installs the new server revision before
    // the old action finishes. The new mount restores the confirmed receipt.
    await panel(workspace('2'))
    await act(async () => activeCheck.resolve(activeResponse()))
    expect(mocks.push).not.toHaveBeenCalled()
    expect(button('Připravit novou verzi').disabled).toBe(true)
    await click('Otevřít potvrzený výsledek')

    // push + refresh on this already-current URL must not be assumed to remount.
    expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/' + quoteId + '?version=' + versionId)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(container.textContent).not.toContain('Otevřít potvrzený výsledek')
    expect(button('Připravit novou verzi').disabled).toBe(false)
    await click('Připravit novou verzi')
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.open.mock.calls[0][0].expectedRevision).toBe('2')
  })

  it('can reconcile an older confirmed receipt from a newer mounted server revision', async () => {
    saveConfirmed()
    await panel(workspace('4'))
    await click('Otevřít potvrzený výsledek')
    expect(button('Připravit novou verzi').disabled).toBe(false)
    await click('Připravit novou verzi')
    expect(mocks.open.mock.calls[0][0].expectedRevision).toBe('4')
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('keeps a stale panel locked even when refresh supplies newer props without remounting it', async () => {
    saveConfirmed()
    await panel(workspace('1'), 'same-panel')
    await panel(workspace('2'), 'same-panel')
    await click('Otevřít potvrzený výsledek')
    expect(button('Připravit novou verzi').disabled).toBe(true)
    expect(container.textContent).toContain('Otevřít potvrzený výsledek')
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each(['company', 'actor'] as const)('retains the receipt if the active %s no longer matches', async field => {
    saveConfirmed()
    mocks.fetch.mockResolvedValue(activeResponse(field === 'company' ? otherId : companyId, field === 'actor' ? otherId : profileId))
    await panel(workspace('2'))
    const saved = sessionStorage.getItem(storageKey)
    await click('Otevřít potvrzený výsledek')
    expect(sessionStorage.getItem(storageKey)).toBe(saved)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(button('Připravit novou verzi').disabled).toBe(true)
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Aktivní firma nebo přihlášení se změnilo')
  })

  it.each(['company', 'actor', 'revision'] as const)('checks live %s props after the pending active-scope request', async field => {
    saveConfirmed()
    const activeCheck = deferred<ReturnType<typeof activeResponse>>()
    mocks.fetch.mockReturnValueOnce(activeCheck.promise)
    await panel(workspace('2'), 'same-panel')
    await click('Otevřít potvrzený výsledek')
    const next = { ...workspace(field === 'revision' ? '3' : '2'), companyId: field === 'company' ? otherId : companyId }
    await panel(next, 'same-panel', field === 'actor' ? otherId : profileId)
    await act(async () => activeCheck.resolve(activeResponse()))
    expect(button('Připravit novou verzi').disabled).toBe(true)
    if (field !== 'revision') {
      expect(sessionStorage.getItem(storageKey)).not.toBeNull()
      expect(mocks.push).not.toHaveBeenCalled()
    }
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('keeps a fresh panel locked when the original outcome is still unknown', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, scope, command }))
    mocks.publish.mockRejectedValue(new Error('response lost'))
    await panel(workspace('2'))
    const saved = sessionStorage.getItem(storageKey)
    await click('Ověřit stejný požadavek')
    expect(sessionStorage.getItem(storageKey)).toBe(saved)
    expect(button('Připravit novou verzi').disabled).toBe(true)
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(command.input)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not resume when removal from session storage fails', async () => {
    saveConfirmed()
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      await panel(workspace('2'))
      await click('Otevřít potvrzený výsledek')
      expect(button('Připravit novou verzi').disabled).toBe(true)
      expect(mocks.push).not.toHaveBeenCalled()
      expect(sessionStorage.getItem(storageKey)).not.toBeNull()
    } finally { remove.mockRestore() }
  })

  it('retains the navigation lock for forms that did not opt into a server-backed view', async () => {
    saveConfirmed()
    function FormWithoutFreshView() {
      const operation = useQuoteOperation({
        scope, parseCommand: raw => raw as typeof command, parseReceipt: raw => raw as ReturnType<typeof receipt>,
        execute: mocks.publish, onSuccess: mocks.push,
      })
      return createElement('button', { onClick: () => operation.run(), 'data-locked': String(operation.locked) }, 'Finish')
    }
    await act(async () => root.render(createElement(FormWithoutFreshView)))
    await click('Finish')
    expect(mocks.push).toHaveBeenCalledOnce()
    expect(button('Finish').dataset.locked).toBe('true')
  })
})


