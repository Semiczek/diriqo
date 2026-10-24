// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssignmentBatch } from '../app/jobs/[jobId]/useAssignmentBatch'
import { assignmentOperationStorageKey, type AssignmentScope } from '../app/jobs/[jobId]/assignment-recovery'

const scope: AssignmentScope = { companyId: '11111111-1111-4111-8111-111111111111', actorProfileId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' }
const worker = '44444444-4444-4444-8444-444444444444', source = '55555555-5555-4555-8555-555555555555'
const token = 'a'.repeat(64), token2 = 'b'.repeat(64)
const input = { id: source, profile_id: worker, labor_hours: 8, hourly_rate: 100, worker_type_snapshot: 'employee', assignment_billing_type: null, external_amount: null, note: 'draft' }
function workspace(scopeToken = token) { return { company_id: scope.companyId, actor_id: scope.actorProfileId, job_id: scope.jobId, scope_token: scopeToken,
  target_job_ids: [scope.jobId], assignments: [{ ...input, company_id: scope.companyId, job_id: scope.jobId, work_started_at: null, work_completed_at: null, archived_at: null }] } }
function response(body: unknown, status = 200) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response) }
function receipt(options: RequestInit, extra: Record<string, unknown> = {}) {
  const body = JSON.parse(String(options.body))
  return { ...workspace(token2), operation_id: body.operationId, kind: options.method === 'DELETE' ? 'delete' : 'upsert',
    assignments: options.method === 'DELETE' ? [] : workspace().assignments,
    deleted_ids: options.method === 'DELETE' ? [source] : [], ...extra }
}
let root: Root, element: HTMLDivElement, api: ReturnType<typeof useAssignmentBatch>
let onCancelled = vi.fn()
let onReceipt = vi.fn(), onWorkspace = vi.fn(), onRestore = vi.fn(), onFailure = vi.fn()
function Harness({ enabled = true, pinned = scope }: { enabled?: boolean; pinned?: AssignmentScope }) {
  const current = useAssignmentBatch({ scope: pinned, enabled, onReceipt, onWorkspace, onRestore, onFailure, onCancelled })
  useLayoutEffect(() => { api = current })
  return createElement('div', null, current.phase)
}
async function mount(props: Parameters<typeof Harness>[0] = {}) { await act(async () => { root.render(createElement(Harness, props)) }) }
async function invoke(fn: () => Promise<void>) { await act(async () => { await fn() }) }
function mutationCalls() { return vi.mocked(fetch).mock.calls.filter(([, options]) => ['POST', 'PUT', 'DELETE'].includes(String(options?.method))) }
function defaultFetch(url: string | URL | Request, options?: RequestInit) {
  if (options?.method) return response({ ok: true, receipt: receipt(options) })
  if (String(url).includes('operationId=')) return response({ ok: true, receipt: null })
  return response({ ok: true, workspace: workspace() })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear()
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  onCancelled = vi.fn(); onReceipt = vi.fn(); onWorkspace = vi.fn(); onRestore = vi.fn(); onFailure = vi.fn()
  vi.stubGlobal('fetch', vi.fn(defaultFetch))
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('actual assignment batch recovery hook', () => {
  it('does not write before the displayed workspace is verified; sends the displayed token with pinned identity', async () => {
    let release!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await mount(); expect(api.locked).toBe(true)
    await invoke(() => api.execute('PUT', { assignments: [input] })); expect(mutationCalls()).toHaveLength(0)
    await act(async () => release(await response({ ok: true, workspace: workspace() })))
    expect(api.locked).toBe(false)
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    const body = JSON.parse(String(mutationCalls()[0][1]?.body))
    expect(body).toMatchObject({ companyId: scope.companyId, actorProfileId: scope.actorProfileId, scopeToken: token, assignments: [input] })
    expect(onReceipt).toHaveBeenCalledOnce(); expect(onWorkspace).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).toBeNull()
  })
  it('persists an uncertain write across reload and requires lookup before an identical replay', async () => {
    vi.mocked(fetch).mockImplementation((url, options) => options?.method ? Promise.reject(Error('lost response')) : defaultFetch(url, options))
    await mount(); await invoke(() => api.execute('PUT', { assignments: [input] }))
    const sent = String(mutationCalls()[0][1]?.body)
    expect(api.phase).toBe('pending'); expect(api.locked).toBe(true)
    await act(async () => root.unmount()); root = createRoot(element); await mount()
    expect(onRestore).toHaveBeenCalledOnce(); expect(api.pending?.command.operationId).toBe(JSON.parse(sent).operationId)
    await invoke(() => api.execute('DELETE', { assignmentId: source })); await invoke(() => api.retry())
    expect(mutationCalls()).toHaveLength(1)
    await invoke(() => api.lookup()); expect(api.canRetry).toBe(true)
    vi.mocked(fetch).mockImplementation(defaultFetch)
    await invoke(() => api.retry())
    expect(mutationCalls()).toHaveLength(2); expect(mutationCalls()[1][1]?.body).toBe(sent)
    expect(api.phase).toBe('ready'); expect(onReceipt).toHaveBeenCalledOnce()
  })
  it('recovers a receipt after a lost response without writing again', async () => {
    let sent!: RequestInit
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method) { sent = options; return Promise.reject(Error('timeout')) }
      return String(url).includes('operationId=') ? response({ ok: true, receipt: receipt(sent) }) : defaultFetch(url)
    })
    await mount(); await invoke(() => api.execute('PUT', { assignments: [input] })); await invoke(() => api.lookup())
    expect(mutationCalls()).toHaveLength(1); expect(onReceipt).toHaveBeenCalledOnce(); expect(api.locked).toBe(false)
  })
  it.each(['missing', 'foreign', 'wrong-operation', 'incomplete', 'wrong-value'])('keeps %s receipt uncertain and never calls success', async invalid => {
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (!options?.method) return defaultFetch(url)
      const saved = receipt(options)
      if (invalid === 'foreign') saved.actor_id = worker
      if (invalid === 'wrong-operation') saved.operation_id = worker
      if (invalid === 'incomplete') saved.assignments = []
      if (invalid === 'wrong-value') saved.assignments[0].labor_hours = 7
      return response({ ok: true, receipt: invalid === 'missing' ? undefined : saved })
    })
    await mount(); await invoke(() => api.execute('PUT', { assignments: [input] }))
    expect(api.phase).toBe('pending'); expect(onReceipt).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).not.toBeNull()
  })
  it('requires explicit refresh after a confirmed conflict and a new operation ID on resubmission', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => options?.method
      ? response({ ok: false, code: 'conflict', uncertain: false }, 409) : response({ ok: true, workspace: workspace(token2) }))
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    const first = JSON.parse(String(mutationCalls()[0][1]?.body))
    expect(api.phase).toBe('conflict'); expect(onFailure).toHaveBeenCalledOnce(); expect(onReceipt).not.toHaveBeenCalled()
    await invoke(() => api.execute('PUT', { assignments: [input] })); expect(mutationCalls()).toHaveLength(1)
    await invoke(() => api.refresh()); expect(onWorkspace).toHaveBeenLastCalledWith(workspace(token2), false)
    vi.mocked(fetch).mockImplementation(defaultFetch)
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    const second = JSON.parse(String(mutationCalls()[1][1]?.body))
    expect(second.operationId).not.toBe(first.operationId); expect(second.scopeToken).toBe(token2)
  })
  it('blocks synchronous double clicks and keeps every HTTP 500 uncertain', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => options?.method
      ? response({ ok: false, code: 'validation', uncertain: false }, 500) : defaultFetch(url))
    await act(async () => { await Promise.all([api.execute('PUT', { assignments: [input] }), api.execute('PUT', { assignments: [input] })]) })
    expect(mutationCalls()).toHaveLength(1); expect(api.phase).toBe('pending'); expect(onFailure).not.toHaveBeenCalled()
  })
  it('rejects corrupt or foreign stored commands and storage failure before dispatch', async () => {
    sessionStorage.setItem(assignmentOperationStorageKey(scope), '{broken')
    await mount(); expect(api.phase).toBe('blocked'); expect(fetch).not.toHaveBeenCalled()
    await invoke(() => api.execute('PUT', { assignments: [input] })); expect(mutationCalls()).toHaveLength(0)
    await act(async () => root.unmount()); root = createRoot(element); sessionStorage.clear(); await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota') })
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    expect(api.phase).toBe('blocked'); expect(mutationCalls()).toHaveLength(0)
  })
  it('does not restore a valid-looking command belonging to another actor', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => options?.method ? Promise.reject(Error('timeout')) : defaultFetch(url))
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    const key = assignmentOperationStorageKey(scope), stored = JSON.parse(sessionStorage.getItem(key)!)
    stored.command.actorProfileId = worker; sessionStorage.setItem(key, JSON.stringify(stored))
    await act(async () => root.unmount()); root = createRoot(element); vi.mocked(fetch).mockClear(); await mount()
    expect(api.phase).toBe('blocked'); expect(fetch).not.toHaveBeenCalled(); expect(onRestore).not.toHaveBeenCalled()
  })
  it('ignores a delayed receipt after actor scope changes and retains the old recovery command', async () => {
    let release!: (value: Response) => void, sent!: RequestInit
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method) { sent = options; return new Promise(resolve => { release = resolve }) }
      return defaultFetch(url)
    })
    let completion!: Promise<void>
    await act(async () => { completion = api.execute('PUT', { assignments: [input] }) })
    await mount({ enabled: false, pinned: { ...scope, actorProfileId: worker } })
    await act(async () => { release(await response({ ok: true, receipt: receipt(sent) })); await completion })
    expect(onReceipt).not.toHaveBeenCalled(); expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).not.toBeNull()
  })
  it('retains a replayed conflict as uncertain until the server can prove a terminal outcome', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => options?.method ? Promise.reject(Error('timeout')) : defaultFetch(url))
    await invoke(() => api.execute('PUT', { assignments: [input] })); await invoke(() => api.lookup())
    const pending = sessionStorage.getItem(assignmentOperationStorageKey(scope))
    vi.mocked(fetch).mockImplementation((url, options) => options?.method
      ? response({ ok: false, code: 'conflict', uncertain: false }, 409) : defaultFetch(url))
    await invoke(() => api.retry())
    expect(api.phase).toBe('pending'); expect(api.canRetry).toBe(false); expect(onFailure).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).toBe(pending)
  })
  it('safely releases a stale uncertain command only after the server confirms a cancellation marker', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method === 'PATCH') { const command = JSON.parse(String(options.body)); return response({ ok: true, receipt: {
        company_id: scope.companyId, actor_id: scope.actorProfileId, job_id: scope.jobId, operation_id: command.operationId, kind: command.kind, cancelled: true,
      } }) }
      return options?.method ? Promise.reject(Error('timeout')) : defaultFetch(url)
    })
    await invoke(() => api.execute('PUT', { assignments: [input] }))
    const original = JSON.parse(String(mutationCalls()[0][1]?.body))
    await invoke(() => api.cancel())
    const cancellation = JSON.parse(String(vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === 'PATCH')?.[1]?.body))
    expect(cancellation).toMatchObject({ ...original, kind: 'upsert' })
    expect(api.phase).toBe('ready'); expect(onCancelled).toHaveBeenCalledOnce(); expect(onReceipt).not.toHaveBeenCalled()
    expect(onWorkspace).toHaveBeenLastCalledWith(workspace(), false)
    expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).toBeNull()
  })
  it('uses the applied receipt when the original write wins the cancellation race', async () => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method === 'PATCH') return response({ ok: true, receipt: receipt(options) })
      return options?.method ? Promise.reject(Error('timeout')) : defaultFetch(url)
    })
    await invoke(() => api.execute('PUT', { assignments: [input] })); await invoke(() => api.cancel())
    expect(onReceipt).toHaveBeenCalledOnce(); expect(onCancelled).not.toHaveBeenCalled(); expect(api.phase).toBe('ready')
  })
  it.each(['foreign', 'lost'])('keeps an unverified %s cancellation pending', async invalid => {
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method === 'PATCH' && invalid === 'foreign') { const command = JSON.parse(String(options.body)); return response({ ok: true, receipt: {
        company_id: scope.companyId, actor_id: worker, job_id: scope.jobId, operation_id: command.operationId, kind: command.kind, cancelled: true,
      } }) }
      return options?.method ? Promise.reject(Error('timeout')) : defaultFetch(url)
    })
    await invoke(() => api.execute('PUT', { assignments: [input] })); await invoke(() => api.cancel())
    expect(api.phase).toBe('pending'); expect(onCancelled).not.toHaveBeenCalled(); expect(onReceipt).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(assignmentOperationStorageKey(scope))).not.toBeNull()
  })
  it('creates an assignment only from a complete receipt, never from the request payload', async () => {
    const newRow = { profile_id: input.profile_id, labor_hours: input.labor_hours, hourly_rate: input.hourly_rate, worker_type_snapshot: input.worker_type_snapshot, assignment_billing_type: null, external_amount: null, note: input.note }
    await mount(); await invoke(() => api.execute('POST', newRow))
    expect(mutationCalls()).toHaveLength(1)
    expect(JSON.parse(String(mutationCalls()[0][1]?.body))).toMatchObject(newRow)
    expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({ assignments: [expect.objectContaining({ id: source })] }), expect.objectContaining({ method: 'POST' }))
  })
  it('recognizes a cancelled operation from a later receipt lookup after a lost cancel response', async () => {
    let operationId = ''
    await mount()
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (options?.method) { operationId = JSON.parse(String(options.body)).operationId; return Promise.reject(Error('timeout')) }
      if (String(url).includes('operationId=')) return response({ ok: true, receipt: { company_id: scope.companyId, actor_id: scope.actorProfileId,
        job_id: scope.jobId, operation_id: operationId, kind: 'upsert', cancelled: true } })
      return defaultFetch(url)
    })
    await invoke(() => api.execute('PUT', { assignments: [input] })); await invoke(() => api.cancel()); await invoke(() => api.lookup())
    expect(onCancelled).toHaveBeenCalledOnce(); expect(onReceipt).not.toHaveBeenCalled(); expect(api.locked).toBe(false)
  })
  it('applies a confirmed delete only from the matching deletion receipt', async () => {
    await mount(); await invoke(() => api.execute('DELETE', { assignmentId: source }))
    expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({ deleted_ids: [source], assignments: [] }), expect.objectContaining({ method: 'DELETE' }))
  })
})
