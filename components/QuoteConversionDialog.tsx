'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createJobFromQuoteAction } from '@/app/business-actions'
import { parseCoreQuoteConversion } from '@/lib/core-quote-conversion'
import { conversionDates, conversionStorageKey, conversionWorkDays, localDateTime, readPendingConversion,
  type PendingQuoteConversion } from './quote-conversion-state'
import styles from './QuoteConversionDialog.module.css'

type Props = {
  companyId: string; actorProfileId: string; quoteId: string; customerId: string | null; versionId?: string
  quoteTitle?: string | null; description?: string | null; contactName?: string | null
  contactEmail?: string | null; shareUrl?: string | null; onClose: () => void
}
const unknownMessage = 'Výsledek zatím nelze potvrdit. Návrh je uložený; ověřte stejný požadavek tlačítkem níže. Nevytvářejte novou zakázku.'

export default function QuoteConversionDialog(props: Props) {
  const [scope] = useState(() => props)
  const storageKey = conversionStorageKey(scope.companyId, scope.actorProfileId, scope.quoteId)
  const [restored] = useState(() => {
    try { return { pending: readPendingConversion(window.sessionStorage.getItem(storageKey), scope), error: '' } }
    catch (error) { return { pending: null, error: error instanceof Error ? error.message : 'Úložiště požadavku není dostupné.' } }
  })
  const [pending, setPending] = useState<PendingQuoteConversion | null>(restored.pending)
  const [error, setError] = useState(restored.error)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{ jobId: string; created: boolean; mail: 'sending' | 'sent' | 'failed' | 'skipped' | 'none' } | null>(null)
  const [startText, setStartText] = useState(() => restored.pending ? localDateTime(new Date(restored.pending.payload.startAt)) : localDateTime(new Date()))
  const [endText, setEndText] = useState(() => restored.pending ? localDateTime(new Date(restored.pending.payload.endAt)) : localDateTime(new Date(Date.now() + 3600000)))
  const [address, setAddress] = useState(restored.pending?.payload.address ?? '')
  const [description, setDescription] = useState(restored.pending?.payload.description ?? scope.description ?? '')
  const [split, setSplit] = useState(Boolean(restored.pending?.payload.splitDays.length))
  const [omittedDays, setOmittedDays] = useState<string[]>([])
  const [sendConfirmation, setSendConfirmation] = useState(restored.pending?.sendConfirmation ?? Boolean(scope.contactEmail?.trim()))
  let dateError = '', longRange = false, days: ReturnType<typeof conversionWorkDays> = []
  try {
    const { start, end } = conversionDates(startText, endText)
    longRange = end.getTime() - start.getTime() > 366 * 86400000
    days = conversionWorkDays(start, end)
  }
  catch (failure) { dateError = failure instanceof Error ? failure.message : 'Neplatný termín.' }
  const effectiveSplit = split && (Boolean(pending) || days.length > 0)
  const locked = busy || Boolean(pending) || Boolean(result) || Boolean(restored.error)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || result || restored.error) return
    const retry = Boolean(pending)
    let operation = pending
    if (!operation) {
      try {
        if (!scope.versionId) throw new Error('Vyberte vydanou přijatou verzi nabídky. Bez ní novou zakázku nevytvoříme.')
        const { start, end } = conversionDates(startText, endText)
        const selected = days.filter(day => !omittedDays.includes(day.dateKey))
        if (effectiveSplit && !selected.length) throw new Error('Vyberte alespoň jeden den realizace.')
        if (sendConfirmation && !scope.contactEmail?.trim()) throw new Error('Chybí kontaktní e-mail. Vypněte odeslání nebo doplňte kontakt v nabídce.')
        operation = { version: 1, actorProfileId: scope.actorProfileId, sendConfirmation, payload: parseCoreQuoteConversion({
          companyId: scope.companyId, quoteId: scope.quoteId, versionId: scope.versionId, operationId: crypto.randomUUID(),
          title: scope.quoteTitle?.trim() || 'Zakázka z cenové nabídky', description: description.trim() || null, address: address.trim() || null,
          startAt: start.toISOString(), endAt: end.toISOString(),
          splitDays: effectiveSplit ? selected.map(day => ({ label: day.label, startAt: day.startAt.toISOString(), endAt: day.endAt.toISOString() })) : [],
        }) }
        // Persist before dispatch: a dropped response or reload must reuse the original payload.
        window.sessionStorage.setItem(storageKey, JSON.stringify(operation))
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Požadavek nelze bezpečně uložit v prohlížeči.')
        return
      }
    }
    inFlight.current = true
    setBusy(true); setPending(operation); setError('')
    try {
      const response = await createJobFromQuoteAction(operation.payload)
      if (!response.ok) {
        setError(response.error)
        // A refusal of a retry says nothing about whether its original attempt committed.
        if (!retry && !response.uncertain) {
          window.sessionStorage.removeItem(storageKey)
          setPending(null)
        }
        return
      }
      try { window.sessionStorage.removeItem(storageKey) } catch { /* A stored successful replay is harmless. */ }
      setPending(null)
      const shouldSend = response.data.created && !retry && operation.sendConfirmation
      setResult({ ...response.data, mail: shouldSend ? 'sending' : operation.sendConfirmation ? 'skipped' : 'none' })
      if (shouldSend) {
        try {
          const format = (date: string) => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
          const text = `Dobrý den${scope.contactName ? ` ${scope.contactName}` : ''},\n\npotvrzujeme termín realizace k Vaší nabídce.\n\n${operation.payload.title}\nZačátek: ${format(operation.payload.startAt)}\nKonec: ${format(operation.payload.endAt)}\n${operation.payload.address || ''}${scope.shareUrl ? `\nOnline nabídka: ${scope.shareUrl}` : ''}\n\nDiriqo`
          const email = await fetch('/api/mail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            relatedEntityType: 'job', relatedEntityId: response.data.jobId, customerId: scope.customerId, messageType: 'job_confirmation',
            toEmail: scope.contactEmail, toName: scope.contactName ?? null, subject: `Potvrzení termínu realizace: ${operation.payload.title}`, text,
          }) })
          setResult({ ...response.data, mail: email.ok ? 'sent' : 'failed' })
        } catch { setResult({ ...response.data, mail: 'failed' }) }
      }
    } catch { setError(unknownMessage) }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <div className={styles.backdrop}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="quote-conversion-heading" tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); props.onClose() }
        if (event.key === 'Tab') {
          const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]'))
            .filter(element => !element.closest('fieldset:disabled'))
          const first = elements[0], last = elements[elements.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <h2 id="quote-conversion-heading">Vytvořit zakázku z nabídky</h2>
      {result ? <section aria-live="polite">
        <p><strong>{result.created ? 'Zakázka byla vytvořena.' : 'Zakázka již existuje. Další jsme nevytvořili.'}</strong></p>
        {result.mail === 'sending' ? <p>Odesíláme potvrzení zákazníkovi…</p> : null}
        {result.mail === 'sent' ? <p>Potvrzení bylo odesláno zákazníkovi.</p> : null}
        {result.mail === 'failed' ? <p role="alert">Zakázka je uložená. Odeslání e-mailu se nepodařilo potvrdit; před dalším odesláním zkontrolujte komunikaci u zakázky.</p> : null}
        {result.mail === 'skipped' ? <p>Při ověření existující zakázky se potvrzení zákazníkovi znovu neposílá. Komunikaci zkontrolujte v zakázce.</p> : null}
        <div className={styles.actions}><button type="button" onClick={props.onClose} disabled={busy}>Zavřít</button><a href={`/jobs/${result.jobId}`}>Otevřít zakázku</a></div>
      </section> : <form onSubmit={submit}>
        {pending ? <p className={styles.notice} role="status">{busy ? 'Požadavek se zpracovává. Vyčkejte prosím na potvrzení výsledku.' : unknownMessage}</p> : <p>Vyberte termín a případně jednotlivé dny. Zakázka zůstane u zákazníka této nabídky.</p>}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <fieldset disabled={locked} className={styles.fields}>
          <label htmlFor="conversion-start">Začátek realizace<input id="conversion-start" type="datetime-local" required value={startText} onChange={event => { setStartText(event.target.value); setOmittedDays([]) }} /></label>
          <label htmlFor="conversion-end">Konec realizace<input id="conversion-end" type="datetime-local" required value={endText} onChange={event => { setEndText(event.target.value); setOmittedDays([]) }} /></label>
          {dateError ? <p className={styles.error}>{dateError}</p> : null}
          <label className={styles.choice}><input type="checkbox" checked={effectiveSplit} disabled={!days.length && !pending} onChange={event => setSplit(event.target.checked)} />Souhrnná zakázka s rozpisem na vybrané dny</label>
          {longRange ? <p>Denní rozpis je dostupný pro termín nejvýše 366 dnů. Delší termín můžete vytvořit jako jednu zakázku.</p> : null}
          {effectiveSplit ? <div className={styles.days}>{pending ? pending.payload.splitDays.map((day, index) => <p key={index}>{day.label} · {localDateTime(new Date(day.startAt)).replace('T', ' ')} – {localDateTime(new Date(day.endAt)).replace('T', ' ')}</p>) : days.map(day => <label key={day.dateKey} className={styles.choice}>
            <input type="checkbox" checked={!omittedDays.includes(day.dateKey)} onChange={event => setOmittedDays(current => event.target.checked ? current.filter(key => key !== day.dateKey) : [...current, day.dateKey])} />
            <span>{day.label}<small>{localDateTime(day.startAt).replace('T', ' ')} – {localDateTime(day.endAt).replace('T', ' ')}</small></span>
          </label>)}</div> : null}
          <label htmlFor="conversion-address">Adresa realizace<input id="conversion-address" value={address} onChange={event => setAddress(event.target.value)} /></label>
          <label htmlFor="conversion-description">Popis zakázky<textarea id="conversion-description" value={description} onChange={event => setDescription(event.target.value)} rows={4} /></label>
          <label className={styles.choice}><input type="checkbox" checked={sendConfirmation} onChange={event => setSendConfirmation(event.target.checked)} />Odeslat zákazníkovi potvrzení termínu{scope.contactEmail ? ` (${scope.contactEmail})` : ''}</label>
        </fieldset>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={props.onClose}>Zavřít</button>
          <button type="submit" disabled={busy || Boolean(restored.error) || (!pending && Boolean(dateError))}>{busy ? 'Ověřujeme převod…' : pending ? 'Ověřit stejný požadavek' : sendConfirmation ? 'Vytvořit a odeslat potvrzení' : 'Vytvořit zakázku'}</button></div>
      </form>}
    </div>
  </div>
}