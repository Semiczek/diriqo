export type OfficeClientContext = { tenantId: string; actorId: string; readOnly: boolean }
export type OfficeContextState = 'ready' | 'checking' | 'changed' | 'unavailable'
export type OfficeContextResult = { ok: true; context: OfficeClientContext } | { ok: false }
export const OFFICE_CONTEXT_EVENT = 'diriqo-office-context-changed'
export const OFFICE_CONTEXT_STORAGE_KEY = 'diriqo-office-context-revision'
const OFFICE_SWITCH_ENDPOINT = '/api/office/company'

export function sameOfficeContext(left: OfficeClientContext, right: OfficeClientContext) {
  return left.tenantId === right.tenantId && left.actorId === right.actorId && left.readOnly === right.readOnly
}

/** A notification is only an invalidation hint. Never accept tenant/role claims from browser storage. */
export function notifyOfficeContextChanged() {
  try { window.localStorage.setItem(OFFICE_CONTEXT_STORAGE_KEY, String(Date.now()) + ':' + Math.random()) } catch { /* Focus/poll checks work when storage is unavailable. */ }
  window.dispatchEvent(new Event(OFFICE_CONTEXT_EVENT))
}

export async function fetchOfficeContext(): Promise<OfficeContextResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    // A proxy login redirect must not navigate away from a document with unsaved edits.
    const response = await fetch('/api/office/context', { cache: 'no-store', credentials: 'same-origin', redirect: 'manual', signal: controller.signal })
    if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return { ok: false }
    const body = await response.json()
    const context = body?.context
    if (body?.ok !== true || !context || typeof context.tenantId !== 'string' || typeof context.actorId !== 'string' || typeof context.readOnly !== 'boolean') return { ok: false }
    return { ok: true, context: { tenantId: context.tenantId, actorId: context.actorId, readOnly: context.readOnly } }
  } catch { return { ok: false } } finally { clearTimeout(timeout) }
}

/** Server guards remain authoritative; this gate protects the draft and gives prompt feedback. */
export function createOfficeContextGuard(expected: OfficeClientContext, onState: (state: OfficeContextState) => void) {
  const pinned = Object.freeze({ ...expected })
  let state: OfficeContextState = 'ready'
  let generation = 0
  let operationGeneration = 0
  // Ordinary successful polling keeps in-flight work valid; any uncertainty or
  // identity change invalidates replies even if this tab later returns to A.
  const setState = (next: OfficeContextState) => { if (next !== 'ready') operationGeneration += 1; state = next; onState(next) }
  const assertReady = () => {
    if (state !== 'ready') throw new Error(state === 'changed' ? 'OFFICE_TENANT_CHANGED' : 'OFFICE_CONTEXT_UNAVAILABLE')
  }
  return {
    get state() { return state },
    assertReady,
    beginOperation() { assertReady(); return operationGeneration },
    assertOperationCurrent(ticket: number) {
      assertReady()
      if (ticket !== operationGeneration) throw new Error('OFFICE_CONTEXT_UNAVAILABLE')
    },
    pause(next: Exclude<OfficeContextState, 'ready'> = 'checking') {
      generation += 1
      setState(next)
    },
    cancelPending() { generation += 1; operationGeneration += 1 },
    async check(probe: () => Promise<OfficeContextResult>, pause = false) {
      const ticket = ++generation
      if (pause) setState('checking')
      let result: OfficeContextResult
      try { result = await probe() } catch { result = { ok: false } }
      // An older response must never re-enable a panel after a later company switch.
      if (ticket !== generation) return
      setState(result.ok ? (sameOfficeContext(pinned, result.context) ? 'ready' : 'changed') : 'unavailable')
    },
    observeFailure(error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/^OFFICE_(?:TENANT_CHANGED|UNAUTHENTICATED|IDENTITY_MISMATCH|DISABLED|FORBIDDEN)(?:$|:)/.test(message)) return false
      generation += 1
      setState(message === 'OFFICE_TENANT_CHANGED' ? 'changed' : 'unavailable')
      return true
    },
  }
}

export type OfficeCompanyOption = { companyId: string; companyName: string | null }

export async function switchOfficeCompany(companyId: string, companies: readonly OfficeCompanyOption[]) {
  // This list was rendered by the server. The existing switch API revalidates live membership.
  if (!companies.some(company => company.companyId === companyId)) throw new Error('OFFICE_FORBIDDEN')
  const response = await fetch(OFFICE_SWITCH_ENDPOINT, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, returnTo: '/office' }),
  })
  if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('OFFICE_COMPANY_SWITCH_FAILED')
  const result = await response.json()
  if (result?.companyId !== companyId) throw new Error('OFFICE_COMPANY_SWITCH_FAILED')
  notifyOfficeContextChanged()
}
