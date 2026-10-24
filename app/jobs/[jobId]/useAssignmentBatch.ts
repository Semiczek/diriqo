"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AssignmentBatchError, parseAssignmentBatchOutcome, type AssignmentBatchCode } from '@/lib/job-assignment-batch'
import { assignmentCommandBody, assignmentOperationStorageKey, makeAssignmentCommand,
  parseAssignmentReceipt, parseAssignmentWorkspace, parseStoredAssignmentCommand,
  type AssignmentCommand, type AssignmentReceipt, type AssignmentScope, type AssignmentWorkspace } from './assignment-recovery'

type Phase = 'loading' | 'ready' | 'pending' | 'conflict' | 'unavailable' | 'blocked'
type Failure = { code: AssignmentBatchCode; status: number; body: unknown }
type Options = { scope: AssignmentScope | null; enabled: boolean;
  onWorkspace: (workspace: AssignmentWorkspace, initial: boolean) => void;
  onReceipt: (receipt: AssignmentReceipt, command: AssignmentCommand) => void;
  onRestore: (command: AssignmentCommand) => void;
  onCancelled: (command: AssignmentCommand) => void;
  onFailure: (failure: Failure, command: AssignmentCommand | null) => void }

export function useAssignmentBatch(options: Options) {
  const callbacks = useRef(options)
  useLayoutEffect(() => { callbacks.current = options })
  const scope = options.scope
  const key = scope ? assignmentOperationStorageKey(scope) : ''
  const epoch = useRef(0), flight = useRef(false)
  const workspace = useRef<AssignmentWorkspace | null>(null)
  const pendingRef = useRef<AssignmentCommand | null>(null)
  const phaseRef = useRef<Phase>('loading')
  const [loadedKey, setLoadedKey] = useState('')
  const [phase, setPhase] = useState<Phase>('loading')
  const [pending, setPending] = useState<AssignmentCommand | null>(null)
  const [busy, setBusy] = useState(false)
  const [canRetry, setCanRetry] = useState(false)
  function move(next: Phase) { phaseRef.current = next; setPhase(next) }
  function remember(command: AssignmentCommand | null) { pendingRef.current = command; setPending(command) }
  function current(ticket: number) { return epoch.current === ticket && callbacks.current.enabled
    && !!callbacks.current.scope && assignmentOperationStorageKey(callbacks.current.scope) === key }
  function url(operationId?: string) {
    return `/api/jobs/${scope!.jobId}/assignments?${new URLSearchParams({ companyId: scope!.companyId,
      actorProfileId: scope!.actorProfileId, ...(operationId ? { operationId } : {}) })}`
  }
  async function loadWorkspace(ticket: number, initial: boolean) {
    try {
      const response = await fetch(url(), { cache: 'no-store' })
      const body = await response.json()
      if (!current(ticket)) return false
      if (!response.ok || body?.ok !== true) throw Error('Workspace unavailable')
      const next = parseAssignmentWorkspace(body.workspace, scope!)
      workspace.current = next; setLoadedKey(key)
      callbacks.current.onWorkspace(next, initial)
      move(pendingRef.current ? 'pending' : 'ready')
      return true
    } catch {
      if (current(ticket)) move(pendingRef.current ? 'pending' : 'unavailable')
      return false
    }
  }
  useEffect(() => {
    const ticket = ++epoch.current
    flight.current = false; workspace.current = null; pendingRef.current = null
    phaseRef.current = 'loading'
    // Restore browser persistence after mount. The generation also protects Strict Mode cleanup.
    void Promise.resolve().then(async () => {
      if (epoch.current !== ticket) return
      setPending(null); setBusy(false); setCanRetry(false); setLoadedKey(''); setPhase('loading')
      if (!scope || !options.enabled) { move('blocked'); return }
      let restored: AssignmentCommand | null = null
      try {
        const raw = sessionStorage.getItem(key)
        if (raw) restored = parseStoredAssignmentCommand(JSON.parse(raw), scope)
      } catch { move('blocked'); return }
      if (restored) remember(restored)
      await loadWorkspace(ticket, true)
      if (current(ticket) && restored) callbacks.current.onRestore(restored)
    })
    return () => { epoch.current = ticket + 1 }
    // Scope identity, rather than callback or object identity, owns this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.enabled])

  async function accept(raw: unknown, stored: AssignmentCommand, ticket: number) {
    const outcome = parseAssignmentBatchOutcome(raw, { ...scope!, operationId: stored.command.operationId, kind: stored.command.kind })
    const cancelled = 'cancelled' in outcome && outcome.cancelled
    const receipt = cancelled ? null : parseAssignmentReceipt(raw, scope!, stored)
    if (!current(ticket)) return
    // Clear persisted uncertainty only after a complete, matching receipt is verified.
    sessionStorage.removeItem(key)
    remember(null); setCanRetry(false); move('loading')
    if (receipt) callbacks.current.onReceipt(receipt, stored)
    else callbacks.current.onCancelled(stored)
    await loadWorkspace(ticket, false)
  }
  async function dispatch(stored: AssignmentCommand, ticket: number, replay: boolean) {
    try {
      const response = await fetch(`/api/jobs/${scope!.jobId}/assignments`, {
        method: stored.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assignmentCommandBody(stored)),
      })
      const body = await response.json()
      if (!current(ticket)) return
      if (response.ok && body?.ok === true) { await accept(body.receipt, stored, ticket); return }
      const code: AssignmentBatchCode = body?.code === 'LABOR_APPROVED_SOURCE_IMMUTABLE' ? 'protected'
        : ['validation', 'forbidden', 'conflict', 'protected', 'unavailable'].includes(body?.code) ? body.code : 'unknown'
      // An ambiguous response, including every 5xx, cannot prove that a transaction rolled back.
      if (replay || response.status >= 500 || response.status < 400 || body?.uncertain !== false || code === 'unknown') throw Error('Unknown result')
      sessionStorage.removeItem(key); remember(null)
      move(code === 'validation' ? 'ready' : 'conflict')
      callbacks.current.onFailure({ code, status: response.status, body }, stored)
    } catch {
      if (current(ticket)) { move('pending'); setCanRetry(false) }
    }
  }
  async function execute(method: AssignmentCommand['method'], payload: Record<string, unknown>) {
    if (!scope || !options.enabled || flight.current || phaseRef.current !== 'ready' || pendingRef.current || !workspace.current
      || workspace.current.company_id !== scope.companyId || workspace.current.actor_id !== scope.actorProfileId || workspace.current.job_id !== scope.jobId) return
    let stored: AssignmentCommand
    try {
      stored = makeAssignmentCommand(scope, workspace.current.scope_token, crypto.randomUUID(), method, payload)
      sessionStorage.setItem(key, JSON.stringify(stored))
    } catch (error) {
      if (error instanceof AssignmentBatchError) {
        callbacks.current.onFailure({ code: 'validation', status: 400, body: null }, null)
      } else move('blocked')
      return
    }
    flight.current = true; setBusy(true); remember(stored); move('pending'); setCanRetry(false)
    const ticket = epoch.current
    await dispatch(stored, ticket, false)
    if (current(ticket)) { flight.current = false; setBusy(false) }
  }
  async function lookup() {
    const stored = pendingRef.current
    if (!scope || !options.enabled || flight.current || !stored) return
    flight.current = true; setBusy(true); setCanRetry(false)
    const ticket = epoch.current
    try {
      const response = await fetch(url(stored.command.operationId), { cache: 'no-store' })
      const body = await response.json()
      if (!current(ticket)) return
      if (!response.ok || body?.ok !== true || !Object.hasOwn(body, 'receipt')) throw Error('Receipt unavailable')
      if (body.receipt === null) setCanRetry(true)
      else await accept(body.receipt, stored, ticket)
    } catch { if (current(ticket)) move('pending') }
    finally { if (current(ticket)) { flight.current = false; setBusy(false) } }
  }
  async function retry() {
    const stored = pendingRef.current
    if (!scope || !options.enabled || flight.current || !stored || !canRetry) return
    flight.current = true; setBusy(true); setCanRetry(false)
    const ticket = epoch.current
    await dispatch(stored, ticket, true)
    if (current(ticket)) { flight.current = false; setBusy(false) }
  }
  async function cancel() {
    const stored = pendingRef.current
    if (!scope || !options.enabled || flight.current || !stored) return
    flight.current = true; setBusy(true); setCanRetry(false)
    const ticket = epoch.current, command = stored.command
    try {
      const response = await fetch(`/api/jobs/${scope.jobId}/assignments`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: command.companyId, actorProfileId: command.actorProfileId,
          operationId: command.operationId, scopeToken: command.scopeToken, kind: command.kind,
          ...(command.kind === 'delete' ? { assignmentId: command.assignmentId } : { assignments: command.assignments }) }),
      })
      const body = await response.json()
      if (!current(ticket)) return
      if (!response.ok || body?.ok !== true) throw Error('Cancellation unconfirmed')
      // The database serializes this marker with the original write. A late original
      // request can no longer apply after a verified cancellation.
      await accept(body.receipt, stored, ticket)
    } catch { if (current(ticket)) move('pending') }
    finally { if (current(ticket)) { flight.current = false; setBusy(false) } }
  }
  async function refresh() {
    if (!scope || !options.enabled || flight.current || pendingRef.current || phaseRef.current === 'blocked') return
    flight.current = true; setBusy(true); move('loading')
    const ticket = epoch.current
    await loadWorkspace(ticket, false)
    if (current(ticket)) { flight.current = false; setBusy(false) }
  }
  return { phase, pending, busy, canRetry, locked: !options.enabled || loadedKey !== key || phase !== 'ready' || busy,
    execute, lookup, retry, cancel, refresh }
}
