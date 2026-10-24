'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { panelSurface } from '@/components/ui/styles'
import { parseLaborRateScheduleInput, type LaborRateListDto, type LaborRateScheduleInput } from '@/lib/labor-history'
import { scheduleWorkerRateAction } from './actions'
import styles from './rates.module.css'

const messages = {
  cs: { title: 'Nákladové sazby', intro: 'Sazba platí od zvoleného dne. Již schválené náklady zůstávají zachované.', back: 'Zpět na pracovníka', history: 'Historie sazeb', empty: 'Zatím není zadaná žádná doložená sazba.', add: 'Nová hodinová sazba', from: 'Platnost od', rate: 'Částka za hodinu', currency: 'Měna', type: 'Druh nákladu', employee: 'Interní práce', contractor: 'Externí práce', reason: 'Důvod změny', reasonHint: 'Například změna smluvené sazby od listopadu.', submit: 'Uložit sazbu', saving: 'Ověřuji uložení…', retry: 'Ověřit stejné uložení', pending: 'Výsledek předchozího uložení ještě není potvrzený. Ověření zopakuje stejný požadavek.', saved: 'Sazba byla uložena.', refresh: 'Načíst aktuální historii', storage: 'Pro bezpečné uložení je potřeba dostupné úložiště této karty. Povolte úložiště a stránku znovu načtěte.', unknown: 'Výsledek uložení není potvrzený. Ověřte stejné uložení.', invalidPending: 'Uložený požadavek nelze ověřit. V této kartě nelze založit další sazbu; nejprve ověřte historii v nové kartě.', zero: 'Nula znamená výslovně nulový náklad. Chybějící sazbu nevyplňujte nulou.', hourly: '/ hod', fixed: 'paušál', noReason: '—' },
  en: { title: 'Cost rates', intro: 'Each rate takes effect on its selected date. Approved costs remain unchanged.', back: 'Back to worker', history: 'Rate history', empty: 'No documented rate has been entered.', add: 'New hourly rate', from: 'Effective from', rate: 'Amount per hour', currency: 'Currency', type: 'Cost type', employee: 'Internal work', contractor: 'External work', reason: 'Reason for change', reasonHint: 'For example, an agreed rate change from November.', submit: 'Save rate', saving: 'Verifying save…', retry: 'Verify the same save', pending: 'The previous save is not confirmed. Verification repeats the same request.', saved: 'The rate was saved.', refresh: 'Reload rate history', storage: 'Safe saving requires storage in this tab. Enable storage and reload the page.', unknown: 'The save is not confirmed. Verify the same save.', invalidPending: 'The stored request cannot be verified. Do not create another rate in this tab; check the history in a new tab first.', zero: 'Zero means an explicitly zero cost. Do not enter zero for a missing rate.', hourly: '/ hour', fixed: 'fixed fee', noReason: '—' },
  de: { title: 'Kostensätze', intro: 'Der Satz gilt ab dem gewählten Datum. Genehmigte Kosten bleiben erhalten.', back: 'Zurück zum Mitarbeiter', history: 'Verlauf der Kostensätze', empty: 'Es wurde noch kein belegter Kostensatz erfasst.', add: 'Neuer Stundensatz', from: 'Gültig ab', rate: 'Betrag pro Stunde', currency: 'Währung', type: 'Kostenart', employee: 'Interne Arbeit', contractor: 'Externe Arbeit', reason: 'Grund der Änderung', reasonHint: 'Zum Beispiel ein vereinbarter neuer Satz ab November.', submit: 'Satz speichern', saving: 'Speicherung wird geprüft…', retry: 'Dieselbe Speicherung prüfen', pending: 'Die vorherige Speicherung ist noch nicht bestätigt. Die Prüfung wiederholt dieselbe Anfrage.', saved: 'Der Kostensatz wurde gespeichert.', refresh: 'Verlauf neu laden', storage: 'Sicheres Speichern erfordert Speicherzugriff in diesem Tab. Aktivieren Sie ihn und laden Sie die Seite neu.', unknown: 'Die Speicherung ist nicht bestätigt. Prüfen Sie dieselbe Speicherung.', invalidPending: 'Die gespeicherte Anfrage kann nicht geprüft werden. Prüfen Sie zunächst den Verlauf in einem neuen Tab.', zero: 'Null bedeutet ausdrücklich kostenfrei. Tragen Sie bei fehlendem Satz keine Null ein.', hourly: '/ Stunde', fixed: 'Pauschale', noReason: '—' },
} as const

export default function WorkerRatesClient({ schedule, actorProfileId }: { schedule: LaborRateListDto; actorProfileId: string }) {
  const { locale } = useI18n()
  const text = messages[locale]
  const router = useRouter()
  const storageKey = `diriqo:labor-rate:v1:${schedule.companyId}:${actorProfileId}:${schedule.profileId}`
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [pending, setPending] = useState<LaborRateScheduleInput | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [conflictCommand, setConflictCommand] = useState<LaborRateScheduleInput | null>(null)
  const [conflictReloadFrom, setConflictReloadFrom] = useState<LaborRateListDto | null>(null)
  const [initialDraft, setInitialDraft] = useState<LaborRateScheduleInput | null>(null)
  const [error, setError] = useState('')
  const flight = useRef(false)
  const alive = useRef(false)
  // A known rejection can be edited after an explicit refresh supplies new server props,
  // even when a duplicate effective date leaves the schedule revision unchanged.
  const conflictActive = Boolean(conflictCommand && (!conflictReloadFrom || conflictReloadFrom === schedule))

  useEffect(() => {
    alive.current = true
    try {
      const stored = window.sessionStorage.getItem(storageKey)
      const draft = stored ?? window.sessionStorage.getItem(`${storageKey}:draft`)
      if (draft) {
        const command = parseLaborRateScheduleInput(JSON.parse(draft))
        if (command.companyId !== schedule.companyId || command.actorProfileId !== actorProfileId || command.profileId !== schedule.profileId) throw new Error('scope')
        // Restoring a versioned browser operation is intentionally done after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setInitialDraft(command)
        if (stored) setPending(command)
      }
      setReady(true)
    } catch {
      setBlocked(true)
      setError(text.invalidPending)
    }
    return () => { alive.current = false }
  }, [storageKey, schedule.companyId, schedule.profileId, actorProfileId, text.invalidPending])

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!ready || busy || blocked || confirmed || conflictActive || flight.current) return
    flight.current = true
    setBusy(true)
    setError('')
    setConflictCommand(null)
    setConflictReloadFrom(null)
    let command = pending
    const replaying = Boolean(pending)
    try {
      if (!command) {
        if (!event) return
        const form = new FormData(event.currentTarget)
        command = parseLaborRateScheduleInput({
          companyId: schedule.companyId, actorProfileId, profileId: schedule.profileId,
          expectedRevision: schedule.revision, operationId: crypto.randomUUID(),
          effectiveFrom: form.get('effectiveFrom'), hourlyRate: form.get('hourlyRate'),
          currency: schedule.currency, unit: 'hour', billingType: 'hourly',
          workerType: form.get('workerType'), reason: form.get('reason'),
        })
        try { window.sessionStorage.setItem(storageKey, JSON.stringify(command)) }
        catch { setBlocked(true); setError(text.storage); return }
        setPending(command)
      }
      let result
      try { result = await scheduleWorkerRateAction(command) }
      catch { if (alive.current) setError(text.unknown); return }
      if (!alive.current) return
      if (!result.ok) {
        setError(result.error)
        // A failure of a retry does not disprove the first attempt's commit.
        if (!result.uncertain && !replaying) {
          if (result.code === 'conflict') setConflictCommand(command)
          try { window.sessionStorage.removeItem(storageKey); setPending(null) }
          catch { setBlocked(true); setError(text.storage) }
        }
        return
      }
      if (result.data.companyId !== command.companyId || result.data.profileId !== command.profileId || result.data.operationId !== command.operationId) {
        setError(text.unknown)
        return
      }
      setConfirmed(true)
      try { window.sessionStorage.removeItem(storageKey); window.sessionStorage.removeItem(`${storageKey}:draft`); setPending(null) }
      catch { setError(text.storage) }
      router.refresh()
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : text.unknown)
    } finally {
      flight.current = false
      if (alive.current) setBusy(false)
    }
  }

  function reloadSchedule() {
    if (conflictCommand) {
      try { window.sessionStorage.setItem(`${storageKey}:draft`, JSON.stringify(conflictCommand)) }
      catch { setBlocked(true); setError(text.storage); return }
      setConflictReloadFrom(schedule)
    }
    router.refresh()
  }

  return <main className={styles.page}>
    <Link href={`/workers/${schedule.profileId}`} className={styles.back}>← {text.back}</Link>
    <header className={styles.header}><p className={styles.context}>{schedule.companyName ?? schedule.companyId} · {schedule.profileName ?? schedule.profileId}</p><h1>{text.title}</h1><p>{text.intro}</p></header>
    {error && (!conflictCommand || conflictActive) && <p role="alert" className={styles.error}>{error}</p>}
    {conflictActive && <div className={styles.notice}><button type="button" className={styles.primary} onClick={reloadSchedule} disabled={blocked}>{text.refresh}</button></div>}
    {confirmed && <p role="status" className={styles.notice}>{text.saved} <button type="button" onClick={() => router.refresh()}>{text.refresh}</button></p>}
    {pending && !confirmed && <div role="status" className={styles.notice}><p>{text.pending}</p><dl><dt>{text.from}</dt><dd>{pending.effectiveFrom}</dd><dt>{text.rate}</dt><dd>{pending.hourlyRate} {pending.currency}</dd><dt>{text.type}</dt><dd>{pending.workerType === 'contractor' ? text.contractor : text.employee}</dd><dt>{text.reason}</dt><dd>{pending.reason}</dd></dl><button type="button" className={styles.primary} disabled={busy || blocked} onClick={() => void save()}>{busy ? text.saving : text.retry}</button></div>}
    <div className={styles.columns}>
      <section style={panelSurface} className={styles.panel} aria-labelledby="rate-history-title">
        <h2 id="rate-history-title">{text.history}</h2>
        {schedule.rates.length === 0 ? <p>{text.empty}</p> : <div className={styles.tableWrap}><table>
          <thead><tr><th scope="col">{text.from}</th><th scope="col">{text.rate}</th><th scope="col">{text.type}</th><th scope="col">{text.reason}</th></tr></thead>
          <tbody>{schedule.rates.map(rate => <tr key={rate.id}>
            <td><time dateTime={rate.effectiveFrom}>{rate.effectiveFrom}</time></td>
            <td className={styles.amount}>{new Intl.NumberFormat(locale, { style: 'currency', currency: rate.currency }).format(Number(rate.hourlyRate))} <span>{rate.unit === 'hour' ? text.hourly : text.fixed}</span></td>
            <td>{rate.workerType === 'contractor' ? text.contractor : text.employee}</td><td>{rate.reason || text.noReason}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <section style={panelSurface} className={styles.panel} aria-labelledby="new-rate-title">
        <h2 id="new-rate-title">{text.add}</h2>
        {/* Mount uncontrolled fields again after restoring their browser draft. */}
        <form key={ready ? 'restored' : 'loading'} onSubmit={event => void save(event)}><fieldset disabled={!ready || busy || blocked || Boolean(pending) || confirmed || conflictActive}>
          <label htmlFor="rate-from">{text.from}</label><input id="rate-from" name="effectiveFrom" type="date" defaultValue={initialDraft?.effectiveFrom ?? ''} required />
          <label htmlFor="rate-amount">{text.rate} ({schedule.currency})</label><input id="rate-amount" name="hourlyRate" defaultValue={initialDraft?.hourlyRate ?? ''} type="number" min="0" step="0.01" inputMode="decimal" aria-describedby="rate-zero-note" required />
          <p id="rate-zero-note" className={styles.hint}>{text.zero}</p>
          <label htmlFor="rate-type">{text.type}</label><select id="rate-type" name="workerType" defaultValue={initialDraft?.workerType ?? 'employee'}><option value="employee">{text.employee}</option><option value="contractor">{text.contractor}</option></select>
          <label htmlFor="rate-reason">{text.reason}</label><textarea id="rate-reason" name="reason" defaultValue={initialDraft?.reason ?? ''} rows={3} maxLength={500} placeholder={text.reasonHint} required />
          <button type="submit" className={styles.primary}>{busy ? text.saving : text.submit}</button>
        </fieldset></form>
      </section>
    </div>
  </main>
}
