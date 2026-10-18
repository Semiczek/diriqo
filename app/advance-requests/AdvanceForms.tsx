'use client'

import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { payAdvanceAction, requestAdvanceAction, reviewAdvanceAction, settleAdvanceAction, type AdvanceActionResult } from './actions'
import { executeAdvanceOperation } from '@/lib/payroll/advance-operation'
import { formatAdvanceMoney } from '@/lib/payroll/advances'
import styles from './advances.module.css'

type Scope = { companyId: string; actorProfileId: string; currency: string }
type Payload = Record<string, string | number | null>

function subscribePending(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener('diriqo-advance-pending', notify)
  return () => { window.removeEventListener('storage', notify); window.removeEventListener('diriqo-advance-pending', notify) }
}

/** Preserve uncertain operations through failed retries, including across reload. */
function useOperation(scope: Scope, suffix: string) {
  const router = useRouter()
  const key = `diriqo-advance-v1:${scope.companyId}:${scope.actorProfileId}:${suffix}`
  const stored = useSyncExternalStore(
    subscribePending,
    () => { try { return sessionStorage.getItem(key) ?? '' } catch { return '#blocked' } },
    () => undefined,
  )
  const pending = useMemo(() => {
    if (!stored || stored === '#blocked') return null
    try {
      const payload = JSON.parse(stored)
      return payload?.companyId === scope.companyId && typeof payload.operationId === 'string' ? payload as Payload : null
    } catch { return null }
  }, [stored, scope.companyId])
  const storageInvalid = stored === '#blocked' || Boolean(stored && !pending)
  const ready = stored !== undefined && !storageInvalid
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  async function submit(payload: Payload, action: (payload: Payload) => Promise<AdvanceActionResult>, onSuccess?: () => void) {
    if (!ready || running.current) return
    running.current = true
    setBusy(true); setError(null); setMessage(null)
    try {
      const result = await executeAdvanceOperation({
        pending, payload, companyId: scope.companyId, newOperationId: () => crypto.randomUUID(), action,
        store: operation => { sessionStorage.setItem(key, JSON.stringify(operation)); window.dispatchEvent(new Event('diriqo-advance-pending')) },
        clear: () => { sessionStorage.removeItem(key); window.dispatchEvent(new Event('diriqo-advance-pending')) },
      })
      if (!result.ok) { setError(result.error); return }
      setMessage(result.data.changed ? 'Záznam byl uložen.' : 'Toto potvrzení již bylo uloženo. Další pohyb nevznikl.')
      onSuccess?.()
      router.refresh()
    } catch {
      setError('Výsledek není potvrzený. Opakujte stejné potvrzení; nevytvářejte novou výplatu.')
    } finally { setBusy(false); running.current = false }
  }
  return { pending, busy, ready, submit, feedback: <>
    {storageInvalid && <p className={styles.error} role="alert">Bezpečné uložení potvrzení není dostupné nebo je poškozené. Před novou výplatou ověřte historii a kontaktujte správce.</p>}
    {pending && !error && <p role="status">Předchozí potvrzení nemá ověřený výsledek. Níže lze opakovat pouze stejné potvrzení.</p>}
    {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => router.refresh()}>Načíst aktuální stav</button></p>}
    {message && <p role="status">{message}</p>}
  </> }
}

export function AdvanceRequestForm(scope: Scope) {
  const operation = useOperation(scope, 'request')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await operation.submit({ amount, reason }, p => requestAdvanceAction({ companyId: scope.companyId, requestId: String(p.operationId), amount: p.amount, reason: String(p.reason) }), () => { setAmount(''); setReason('') })
  }
  return <form className={styles.form} onSubmit={submit}>
    <h2>Požádat o zálohu</h2>
    <fieldset disabled={!operation.ready || operation.busy || Boolean(operation.pending)}>
      <label>Požadovaná částka ({scope.currency})<input value={operation.pending ? String(operation.pending.amount) : amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /></label>
      <label>Důvod žádosti<textarea value={operation.pending ? String(operation.pending.reason) : reason} onChange={e => setReason(e.target.value)} maxLength={2000} required /></label>
    </fieldset>
    {operation.feedback}
    <button className={styles.primary} disabled={!operation.ready || operation.busy}>{operation.busy ? 'Ukládám…' : operation.pending ? 'Ověřit stejné potvrzení' : 'Odeslat žádost'}</button>
  </form>
}

export function AdvanceReviewForm(props: Scope & { requestId: string; revision: number; requestedAmount: number | string }) {
  const operation = useOperation(props, `review:${props.requestId}`)
  const [amount, setAmount] = useState(String(props.requestedAmount))
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await operation.submit({ amount, reason, status: decision, revision: props.revision, requestId: props.requestId }, p => reviewAdvanceAction({
      companyId: props.companyId, requestId: String(p.requestId), revision: Number(p.revision), operationId: String(p.operationId),
      status: p.status as 'approved' | 'rejected', amount: p.amount, reason: String(p.reason),
    }))
  }
  return <form className={styles.form} onSubmit={submit}>
    <fieldset disabled={!operation.ready || operation.busy || Boolean(operation.pending)}>
      <label>Rozhodnutí<select value={operation.pending ? String(operation.pending.status) : decision} onChange={e => setDecision(e.target.value as typeof decision)}><option value="approved">Schválit</option><option value="rejected">Zamítnout</option></select></label>
      <label>Schválená částka ({props.currency})<input value={operation.pending ? String(operation.pending.amount) : amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></label>
      <label>Důvod rozhodnutí<textarea value={operation.pending ? String(operation.pending.reason) : reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="Povinné při změně požadované částky" /></label>
    </fieldset>
    {operation.feedback}
    <button className={styles.primary} disabled={!operation.ready || operation.busy}>{operation.busy ? 'Ukládám…' : operation.pending ? 'Ověřit stejné potvrzení' : 'Potvrdit rozhodnutí'}</button>
  </form>
}

export function AdvancePaymentForm(props: Scope & { requestId: string | null; profileId: string; revision: number | null; remaining?: number; today: string }) {
  const operation = useOperation(props, `pay:${props.requestId ?? props.profileId}`)
  const [amount, setAmount] = useState('')
  const [issuedOn, setIssuedOn] = useState(props.today)
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await operation.submit({ amount, issuedOn, method, reference, note, revision: props.revision, requestId: props.requestId, profileId: props.profileId }, p => payAdvanceAction({
      companyId: props.companyId, requestId: p.requestId as string | null, profileId: String(p.profileId), revision: p.revision as number | null,
      operationId: String(p.operationId), amount: p.amount, issuedOn: String(p.issuedOn), method: p.method as typeof method, reference: String(p.reference), note: String(p.note),
    }), () => { setAmount(''); setReference(''); setNote('') })
  }
  const value = (field: string, current: string) => operation.pending ? String(operation.pending[field] ?? '') : current
  return <form className={styles.form} onSubmit={submit}>
    <h3>Zaznamenat výplatu{props.remaining != null ? ` · zbývá ${formatAdvanceMoney(props.remaining, props.currency)}` : ''}</h3>
    <p>Potvrďte skutečně předanou nebo odeslanou částku. Diriqo peníze neposílá.</p>
    <fieldset disabled={!operation.ready || operation.busy || Boolean(operation.pending)}>
      <label>Vyplacená částka ({props.currency})<input inputMode="decimal" required value={value('amount', amount)} onChange={e => setAmount(e.target.value)} /></label>
      <label>Datum výplaty<input type="date" required value={value('issuedOn', issuedOn)} onChange={e => setIssuedOn(e.target.value)} /></label>
      <label>Způsob<select value={value('method', method)} onChange={e => setMethod(e.target.value as typeof method)}><option value="cash">Hotově</option><option value="bank_transfer">Bankovní převod</option></select></label>
      <label>Reference dokladu / převodu<input value={value('reference', reference)} onChange={e => setReference(e.target.value)} required={method === 'bank_transfer'} maxLength={200} /></label>
      <label>Poznámka<textarea value={value('note', note)} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
    </fieldset>
    {operation.feedback}
    <button className={styles.primary} disabled={!operation.ready || operation.busy}>{operation.busy ? 'Ukládám…' : operation.pending ? 'Ověřit stejné potvrzení' : 'Potvrdit záznam výplaty'}</button>
  </form>
}

export function AdvanceSettlementForm(props: Scope & { paymentId: string; outstanding: number; today: string }) {
  const operation = useOperation(props, `settle:${props.paymentId}`)
  const [amount, setAmount] = useState('')
  const [settledOn, setSettledOn] = useState(props.today)
  const [method, setMethod] = useState<'returned' | 'payroll_offset'>('returned')
  const [reference, setReference] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await operation.submit({ amount, settledOn, method, reference, paymentId: props.paymentId }, p => settleAdvanceAction({
      companyId: props.companyId, paymentId: String(p.paymentId), operationId: String(p.operationId), amount: p.amount,
      settledOn: String(p.settledOn), method: p.method as typeof method, reference: String(p.reference),
    }), () => { setAmount(''); setReference('') })
  }
  const value = (field: string, current: string) => operation.pending ? String(operation.pending[field] ?? '') : current
  return <form className={styles.form} onSubmit={submit}>
    <h3>Zaznamenat vypořádání · zbývá {formatAdvanceMoney(props.outstanding, props.currency)}</h3>
    <p>Zapište doložené vrácení nebo již provedené započtení. Tímto potvrzením se peníze nepřevádějí ani nesrážejí ze mzdy.</p>
    <fieldset disabled={!operation.ready || operation.busy || Boolean(operation.pending)}>
      <label>Částka ({props.currency})<input required inputMode="decimal" value={value('amount', amount)} onChange={e => setAmount(e.target.value)} /></label>
      <label>Datum vypořádání<input required type="date" value={value('settledOn', settledOn)} onChange={e => setSettledOn(e.target.value)} /></label>
      <label>Způsob<select value={value('method', method)} onChange={e => setMethod(e.target.value as typeof method)}><option value="returned">Vráceno pracovníkem</option><option value="payroll_offset">Doložené započtení</option></select></label>
      <label>Reference dokladu<input required maxLength={200} value={value('reference', reference)} onChange={e => setReference(e.target.value)} /></label>
    </fieldset>
    {operation.feedback}
    <button className={styles.primary} disabled={!operation.ready || operation.busy}>{operation.busy ? 'Ukládám…' : operation.pending ? 'Ověřit stejné potvrzení' : 'Potvrdit záznam vypořádání'}</button>
  </form>
}
