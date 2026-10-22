'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { updateQuoteAction } from '@/app/business-actions'
import { parseCoreQuoteDraft, parseCoreQuoteReceipt, previewCoreQuoteItems, type CoreQuoteDraftFormValues } from '@/lib/core-quote-lifecycle'
import { useQuoteOperation } from './useQuoteOperation'
import { quoteDetailHref } from './quote-lifecycle-state'
import styles from './QuoteLifecycle.module.css'

type Props = { customerId: string | null; initialValues: CoreQuoteDraftFormValues }
const contentFields = [
  ['contactName', 'Kontaktní osoba'], ['contactEmail', 'Kontaktní e-mail'], ['introText', 'Úvod'],
  ['customerRequestTitle', 'Nadpis zadání'], ['customerRequest', 'Zadání zákazníka'],
  ['ourSolutionTitle', 'Nadpis řešení'], ['proposedSolution', 'Navržené řešení'], ['benefitsText', 'Přínosy'],
  ['timelineTitle', 'Nadpis harmonogramu'], ['workDescription', 'Popis práce'], ['workSchedule', 'Harmonogram'],
  ['pricingTitle', 'Nadpis ceny'], ['pricingText', 'Vysvětlení ceny'], ['paymentTermsTitle', 'Nadpis podmínek'], ['paymentTerms', 'Platební podmínky'],
] as const

export default function QuoteEditForm({ customerId, initialValues }: Props) {
  const router = useRouter()
  const [values, setValues] = useState(() => initialValues)
  const [localError, setLocalError] = useState('')
  const operation = useQuoteOperation({
    scope: { companyId: initialValues.companyId, profileId: initialValues.profileId, entityId: initialValues.quoteId, slot: 'edit' },
    parseCommand: raw => {
      const parsed = parseCoreQuoteDraft(raw)
      if (parsed.companyId !== values.companyId || parsed.profileId !== values.profileId || parsed.quoteId !== values.quoteId) throw new Error('Požadavek patří k jiné nabídce nebo firmě.')
      return parsed
    },
    parseReceipt: (raw, command) => parseCoreQuoteReceipt(raw, command, 'update'),
    execute: updateQuoteAction,
    onSuccess: receipt => { router.push(quoteDetailHref(receipt.quoteId, customerId)); router.refresh() },
  })
  const shown = operation.pending?.command ?? values
  let preview: ReturnType<typeof previewCoreQuoteItems> | null = null
  try { preview = previewCoreQuoteItems(shown.items, shown.discountAmount) } catch { /* Incomplete input stays editable. */ }
  function setField<K extends keyof CoreQuoteDraftFormValues>(key: K, value: CoreQuoteDraftFormValues[K]) { setValues(current => ({ ...current, [key]: value })) }
  function setItem(index: number, key: keyof CoreQuoteDraftFormValues['items'][number], value: string) {
    setValues(current => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, [key]: value } : item) }))
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError('')
    try { await operation.run({ ...values, operationId: crypto.randomUUID() }) }
    catch (error) { setLocalError(error instanceof Error ? error.message : 'Nabídku nelze uložit.') }
  }
  return <form onSubmit={submit} className={styles.form}>
    {operation.error || localError ? <div role="alert" className={styles.error}>{operation.error || localError}</div> : null}
    {operation.pending ? <div role="status" className={styles.notice}>
      {operation.pending.receipt ? 'Uložení je potvrzené. Ověřte aktivní firmu a otevřete výsledek.' : 'Uložený požadavek čeká na potvrzení. Zachováme stejné údaje a číslo operace.'}
    </div> : null}
    <fieldset disabled={operation.locked}>
      <section className={styles.card}>
        <h2>Základ nabídky</h2>
        <div className={styles.grid}>
          <label className={styles.field}>Název nabídky<input id="quote-title" value={shown.title} onChange={e => setField('title', e.target.value)} required maxLength={300} /></label>
          <label className={styles.field}>Datum<input id="quote-date" type="date" value={shown.quoteDate ?? ''} onChange={e => setField('quoteDate', e.target.value)} required /></label>
          <label className={styles.field}>Platí do<input id="quote-valid-until" type="date" value={shown.validUntil ?? ''} onChange={e => setField('validUntil', e.target.value || null)} /></label>
          <label className={styles.field}>Měna<input value={shown.currency} readOnly /></label>
          <label className={styles.field}>Cenový režim<select id="quote-pricing-mode" value={shown.pricingMode} onChange={e => setField('pricingMode', e.target.value)} required><option value="">Zvolte cenový režim</option><option value="net">Ceny bez DPH</option></select></label>
          <label className={styles.field}>Sleva bez DPH ({shown.currency || 'měna nedoložena'})<input id="quote-discount" inputMode="decimal" value={shown.discountAmount} onChange={e => setField('discountAmount', e.target.value)} /></label>
        </div>
      </section>
      <section className={styles.card}>
        <h2>Položky pro zákazníka</h2>
        <div className={styles.stack}>{shown.items.map((item, index) => <div key={index} className={styles.item}>
          <div className={styles.grid}>
            <label className={styles.field}>Položka<input id={`quote-item-${index}-name`} value={item.name} onChange={e => setItem(index, 'name', e.target.value)} required /></label>
            <label className={styles.field}>Množství<input id={`quote-item-${index}-quantity`} inputMode="decimal" value={item.quantity} onChange={e => setItem(index, 'quantity', e.target.value)} /></label>
            <label className={styles.field}>Jednotka<input id={`quote-item-${index}-unit`} value={item.unit ?? ''} onChange={e => setItem(index, 'unit', e.target.value)} /></label>
            <label className={styles.field}>Cena za jednotku bez DPH<input id={`quote-item-${index}-unitPrice`} inputMode="decimal" value={item.unitPrice} onChange={e => setItem(index, 'unitPrice', e.target.value)} /></label>
            <label className={styles.field}>DPH (%)<input id={`quote-item-${index}-vatRate`} inputMode="decimal" value={item.vatRate ?? ''} placeholder="Doplňte sazbu" onChange={e => setItem(index, 'vatRate', e.target.value)} /></label>
          </div>
          <label className={styles.field}>Popis<input id={`quote-item-${index}-description`} value={item.description ?? ''} onChange={e => setItem(index, 'description', e.target.value)} /></label>
          <label className={styles.field}>Poznámka pro zákazníka<input id={`quote-item-${index}-note`} value={item.note ?? ''} onChange={e => setItem(index, 'note', e.target.value)} /></label>
          <div><button type="button" className={styles.button} onClick={() => setField('items', values.items.filter((_, i) => i !== index))}>Odebrat položku {index + 1}</button></div>
        </div>)}</div>
        <div style={{ marginTop: 16 }}><button type="button" className={styles.button} onClick={() => setField('items', [...values.items, { name: '', description: null, quantity: '1', unit: null, unitPrice: '', vatRate: '', note: null }])}>Přidat položku</button></div>
      </section>
      <section className={styles.card}>
        <h2>Texty a podmínky</h2>
        <div className={styles.grid}>{contentFields.map(([key, label]) => <label key={key} className={styles.field}>{label}
          {key.endsWith('Title') || key.startsWith('contact') ? <input id={'quote-' + key} value={shown.content[key] ?? ''} onChange={e => setField('content', { ...values.content, [key]: e.target.value })} /> :
            <textarea id={'quote-' + key} value={shown.content[key] ?? ''} onChange={e => setField('content', { ...values.content, [key]: e.target.value })} />}
        </label>)}</div>
      </section>
      <section className={styles.card}>
        <div className={styles.grid}>
          <label className={styles.field}>Poznámka pro zákazníka<textarea id="quote-customer-note" value={shown.customerNote ?? ''} onChange={e => setField('customerNote', e.target.value)} /></label>
          <label className={styles.field}>Interní poznámka<textarea id="quote-internal-note" value={shown.internalNote ?? ''} onChange={e => setField('internalNote', e.target.value)} /><span className={styles.muted}>Zůstane pouze uvnitř firmy.</span></label>
        </div>
      </section>
<div className={styles.card}><span className={styles.muted}>Celkem po slevě, bez DPH</span><div className={styles.total}>{preview ? preview.totalPrice.replace('.', ',') + ' ' + shown.currency : 'Doplňte platné položky a slevu'}</div></div>
      <div className={styles.actions}><button className={styles.primary} type="submit">{operation.busy ? 'Ukládám…' : 'Uložit koncept'}</button><Link className={styles.button} href={quoteDetailHref(values.quoteId, customerId)}>Zpět na nabídku</Link></div>
    </fieldset>
    {operation.retryAvailable ? <button type="button" className={styles.primary} onClick={() => operation.run()}>{operation.pending?.receipt ? 'Otevřít uloženou nabídku' : 'Ověřit stejný požadavek'}</button> : null}
  </form>
}
