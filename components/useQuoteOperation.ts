'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QUOTE_PENDING_ERROR, QUOTE_STORAGE_ERROR, QUOTE_UNKNOWN_RESULT, quoteOperationKey,
  readPendingQuoteOperation, verifyQuoteActiveScope, type PendingQuoteOperation, type QuoteOperationScope } from './quote-lifecycle-state'

type Result<R> = { ok: true; data: R } | { ok: false; error: string; code: string; uncertain: boolean }
export function useQuoteOperation<T, R>(options: {
  scope: QuoteOperationScope
  parseCommand: (raw: unknown) => T
  parseReceipt: (raw: unknown, command: T) => R
  execute: (command: T) => Promise<Result<R>>
  onSuccess: (receipt: R, command: T) => void
}) {
  const [scope] = useState(options.scope)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState<PendingQuoteOperation<T, R> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storageBlocked, setStorageBlocked] = useState(false)
  const inFlight = useRef(false)
  const pendingRef = useRef<PendingQuoteOperation<T, R> | null>(null)
  const blockedRef = useRef(false)
  const alive = useRef(false)
  const currentScope = useRef(quoteOperationKey(options.scope))
  useLayoutEffect(() => { currentScope.current = quoteOperationKey(options.scope) }, [options.scope])
  const key = quoteOperationKey(scope)
  const changedScope = quoteOperationKey(options.scope) !== key
  useEffect(() => {
    alive.current = true
    // Read browser storage only after hydration so server and initial client markup agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = readPendingQuoteOperation(window.sessionStorage.getItem(key), scope, options.parseCommand, options.parseReceipt); pendingRef.current = saved; setPending(saved) }
    catch (failure) { blockedRef.current = true; setStorageBlocked(true); setError(failure instanceof Error ? failure.message : QUOTE_PENDING_ERROR) }
    setReady(true)
    return () => { alive.current = false }
    // Restore once. Server refresh must not pair old input with a new revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope])

  function persist(value: PendingQuoteOperation<T, R>) {
    try { window.sessionStorage.setItem(key, JSON.stringify(value)) }
    catch { blockedRef.current = true; setStorageBlocked(true); throw new Error(QUOTE_STORAGE_ERROR) }
  }
  async function finish(operation: PendingQuoteOperation<T, R>) {
    if (operation.receipt === undefined) return
    if (!alive.current || currentScope.current !== key) return
    await verifyQuoteActiveScope(scope)
    if (!alive.current || currentScope.current !== key) return
    try { window.sessionStorage.removeItem(key) }
    catch { blockedRef.current = true; setStorageBlocked(true); throw new Error(QUOTE_STORAGE_ERROR) }
    // Keep the confirmed result locked until navigation/remount. No second operation on a stale form.
    options.onSuccess(operation.receipt, operation.command)
  }
  async function run(raw?: unknown) {
    if (!ready || changedScope || currentScope.current !== key || inFlight.current || blockedRef.current || storageBlocked) return
    inFlight.current = true; setBusy(true); setError('')
    let operation = pendingRef.current
    const retry = Boolean(operation)
    try {
      if (!operation) {
        operation = { version: 1, scope, command: options.parseCommand(raw) }
        persist(operation)
        pendingRef.current = operation; setPending(operation)
      }
      if (operation.receipt !== undefined) { await finish(operation); return }
      let result: Result<R>
      try { result = await options.execute(operation.command) }
      catch { setError(QUOTE_UNKNOWN_RESULT); return }
      if (!result || typeof result !== 'object') { setError(QUOTE_UNKNOWN_RESULT); return }
      if (!result.ok) {
        if (!retry && result.uncertain === false && ['validation', 'forbidden', 'conflict', 'unavailable'].includes(result.code)) {
          try { window.sessionStorage.removeItem(key); pendingRef.current = null; setPending(null) }
          catch { blockedRef.current = true; setStorageBlocked(true); throw new Error(QUOTE_STORAGE_ERROR) }
        }
        setError(typeof result.error === 'string' ? result.error : QUOTE_UNKNOWN_RESULT)
        return
      }
      let receipt: R
      try { receipt = options.parseReceipt(result.data, operation.command) }
      catch { setError(QUOTE_UNKNOWN_RESULT); return }
      operation = { ...operation, receipt }
      pendingRef.current = operation; setPending(operation)
      persist(operation)
      await finish(operation)
    } catch (failure) { setError(failure instanceof Error ? failure.message : QUOTE_UNKNOWN_RESULT) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return { run, pending, busy, ready, error: changedScope ? 'Aktivní firma nebo přihlášení se změnilo. Obnovte stránku.' : error,
    locked: !ready || busy || Boolean(pending) || storageBlocked || changedScope,
    retryAvailable: ready && Boolean(pending) && !busy && !storageBlocked && !changedScope }
}
