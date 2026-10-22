'use client'

import { useState } from 'react'
import { coreQuoteId } from '@/lib/core-quote-lifecycle'
import { useQuoteOperation } from './useQuoteOperation'
import styles from './QuoteLifecycle.module.css'

type Props = { companyId: string; profileId: string; quoteId: string; versionId: string; versionNumber: number; title: string; contactEmail?: string | null; shareUrl: string | null }
type MailCommand = { companyId: string; profileId: string; quoteId: string; versionId: string; operationId: string; toEmail: string; subject: string; text: string }
type MailReceipt = { deliveryState: 'sent'; quoteId: string; versionId: string; operationId: string }
export default function QuoteSendForm(props: Props) {
  const [recipient, setRecipient] = useState(props.contactEmail ?? '')
  const [subject, setSubject] = useState('Cenová nabídka: ' + props.title)
  const [body, setBody] = useState('Dobrý den,\n\nzasíláme Vám cenovou nabídku.\n\nS pozdravem')
  const [sent, setSent] = useState(false)
  const operation = useQuoteOperation<MailCommand, MailReceipt>({
    scope: { companyId: props.companyId, profileId: props.profileId, entityId: props.quoteId + ':' + props.versionId, slot: 'mail' },
    parseCommand: raw => {
      if (!raw || typeof raw !== 'object') throw new Error('Zkontrolujte zprávu.')
      const p = raw as MailCommand
      if (p.companyId !== props.companyId || p.profileId !== props.profileId || p.quoteId !== props.quoteId || p.versionId !== props.versionId) throw new Error('Zpráva patří k jiné verzi nebo firmě.')
      if (typeof p.toEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.toEmail.trim()) || p.toEmail.length > 320 || typeof p.subject !== 'string' || !p.subject.trim() || p.subject.length > 500 || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 20000) throw new Error('Vyplňte platný e-mail, předmět a zprávu.')
      return { companyId: coreQuoteId(p.companyId), profileId: coreQuoteId(p.profileId), quoteId: coreQuoteId(p.quoteId), versionId: coreQuoteId(p.versionId), operationId: coreQuoteId(p.operationId), toEmail: p.toEmail.trim(), subject: p.subject.trim(), text: p.text }
    },
    parseReceipt: (raw, command) => {
      if (!raw || typeof raw !== 'object') throw new Error('Neúplné potvrzení odeslání.')
      const receipt = raw as MailReceipt
      if (receipt.deliveryState !== 'sent' || receipt.quoteId !== command.quoteId || receipt.versionId !== command.versionId || receipt.operationId !== command.operationId) throw new Error('Neúplné potvrzení odeslání.')
      return receipt
    },
    execute: async command => {
      const response = await fetch('/api/mail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        companyId: command.companyId, profileId: command.profileId, relatedEntityType: 'offer', relatedEntityId: command.quoteId, versionId: command.versionId, operationId: command.operationId,
        toEmail: command.toEmail, subject: command.subject, text: command.text,
      }) })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.ok !== true || data?.deliveryState !== 'sent') return { ok: false, code: 'unknown', uncertain: true, error: typeof data?.error === 'string' ? data.error : 'Odeslání zatím nelze potvrdit. Ověřte stav stejné zprávy.' }
      return { ok: true, data }
    },
    onSuccess: () => setSent(true),
  })
  const shown = operation.pending?.command
  if (sent) return <p role="status" className={styles.notice}>Odeslání verze {props.versionNumber} bylo potvrzené.</p>
  return <form className={styles.card} onSubmit={async event => {
    event.preventDefault()
    const link = props.shareUrl ? new URL(props.shareUrl, window.location.origin).href : ''
    await operation.run({ companyId: props.companyId, profileId: props.profileId, quoteId: props.quoteId, versionId: props.versionId, operationId: crypto.randomUUID(), toEmail: recipient, subject, text: body + (link ? '\n\nNabídka, verze ' + props.versionNumber + ':\n' + link : '') })
  }}>
    <h2>Odeslat verzi {props.versionNumber}</h2>
    {operation.error ? <p role="alert" className={styles.error}>{operation.error}</p> : null}
    <fieldset disabled={operation.locked} className={styles.stack} style={{ padding: 0, border: 0 }}>
      <label className={styles.field}>E-mail příjemce<input id="quote-mail-recipient" type="email" required value={shown?.toEmail ?? recipient} onChange={e => setRecipient(e.target.value)} /></label>
      <label className={styles.field}>Předmět<input id="quote-mail-subject" required value={shown?.subject ?? subject} onChange={e => setSubject(e.target.value)} /></label>
      <label className={styles.field}>Zpráva<textarea id="quote-mail-body" required value={shown?.text ?? body} onChange={e => setBody(e.target.value)} /></label>
      <p className={styles.muted}>Připojíme odkaz na vybranou vydanou verzi.</p>
      <button type="submit" className={styles.primary}>{operation.busy ? 'Odesílám…' : 'Odeslat nabídku'}</button>
    </fieldset>
    {operation.retryAvailable ? <button type="button" className={styles.button} onClick={() => operation.run()}>Ověřit stav stejné zprávy</button> : null}
  </form>
}
