'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { archiveQuoteAction, deleteQuoteAction, openQuoteRevisionAction, publishQuoteAction,
  recordQuoteDecisionAction, revokeQuotePublicationAction, syncQuotePricingFromCalculationAction } from '@/app/business-actions'
import { parseCoreQuoteArchive, parseCoreQuoteDecision, parseCoreQuoteDelete, parseCoreQuoteOpenRevision,
  parseCoreQuotePublish, parseCoreQuoteReceipt, parseCoreQuoteSync, parseCoreQuoteRevoke,
  type CoreQuoteCommandInput, type CoreQuoteCommandKind, type CoreQuoteWorkspace } from '@/lib/core-quote-lifecycle'
import QuoteConversionDialog from './QuoteConversionDialog'
import QuoteSendForm from './QuoteSendForm'
import { useQuoteOperation } from './useQuoteOperation'
import { quoteDetailHref } from './quote-lifecycle-state'
import { localDateTime } from './quote-conversion-state'
import styles from './QuoteLifecycle.module.css'

type Command = { kind: Exclude<CoreQuoteCommandKind, 'create' | 'update'>; input: CoreQuoteCommandInput }
function parseCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object' || !('kind' in raw) || !('input' in raw)) throw new Error('Neplatná operace nabídky.')
  switch (raw.kind) {
    case 'sync': return { kind: raw.kind, input: parseCoreQuoteSync(raw.input) }
    case 'openRevision': return { kind: raw.kind, input: parseCoreQuoteOpenRevision(raw.input) }
    case 'publish': return { kind: raw.kind, input: parseCoreQuotePublish(raw.input) }
    case 'decision': return { kind: raw.kind, input: parseCoreQuoteDecision(raw.input) }
    case 'revoke': return { kind: raw.kind, input: parseCoreQuoteRevoke(raw.input) }
    case 'archive': return { kind: raw.kind, input: parseCoreQuoteArchive(raw.input) }
    case 'delete': return { kind: raw.kind, input: parseCoreQuoteDelete(raw.input) }
    default: throw new Error('Neplatná operace nabídky.')
  }
}
async function execute(command: Command) {
  switch (command.kind) {
    case 'sync': return syncQuotePricingFromCalculationAction(command.input)
    case 'openRevision': return openQuoteRevisionAction(command.input)
    case 'publish': return publishQuoteAction(command.input)
    case 'decision': return recordQuoteDecisionAction(command.input)
    case 'revoke': return revokeQuotePublicationAction(command.input)
    case 'archive': return archiveQuoteAction(command.input)
    case 'delete': return deleteQuoteAction(command.input)
  }
}
export type QuoteActionsPanelProps = {
  workspace: CoreQuoteWorkspace; actorProfileId: string; selectedVersionId: string | null; selectedKind: 'draft' | 'issued' | 'legacy'
  quoteTitle: string; contactName?: string | null; contactEmail?: string | null; description?: string | null
}
export default function QuoteActionsPanel(props: QuoteActionsPanelProps) {
  const router = useRouter()
  const [scope] = useState(props.workspace)
  const [evidence, setEvidence] = useState('')
  const [decidedAt, setDecidedAt] = useState(() => localDateTime(new Date()))
  const [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted')
  const [showDecision, setShowDecision] = useState(false)
  const [showConversion, setShowConversion] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [message, setMessage] = useState('')
  const version = props.workspace.versions.find(version => version.versionId === props.selectedVersionId)
  const shareUrl = version?.shareToken ? '/offer/' + encodeURIComponent(version.shareToken) : null
  const baseHref = quoteDetailHref(scope.quoteId, scope.customerId)
  const isDraft = props.selectedKind === 'draft' && props.workspace.draftOpen
  const isLegacyBaseline = props.selectedKind === 'legacy' && Boolean(props.workspace.legacy) && props.workspace.versions.length === 0 && props.workspace.currentVersionId === null
  const operation = useQuoteOperation({
    scope: { companyId: props.workspace.companyId, profileId: props.actorProfileId, entityId: props.workspace.quoteId, slot: 'actions' },
    confirmedView: { revision: props.workspace.revision, receiptRevision: receipt => receipt.revision },
    parseCommand: raw => {
      const command = parseCommand(raw)
      if (command.input.companyId !== scope.companyId || command.input.profileId !== props.actorProfileId || !('quoteId' in command.input) || command.input.quoteId !== scope.quoteId) throw new Error('Požadavek patří k jiné nabídce nebo firmě.')
      return command
    },
    parseReceipt: (raw, command) => parseCoreQuoteReceipt(raw, command.input, command.kind), execute,
    onSuccess: (receipt, command) => {
      const href = command.kind === 'delete' ? (scope.customerId ? `/customers/${scope.customerId}/quotes` : '/cenove-nabidky') :
        command.kind === 'openRevision' ? baseHref + '/edit' : command.kind === 'revoke' && 'versionId' in command.input && command.input.versionId === null ? baseHref + '?version=legacy' : quoteDetailHref(receipt.quoteId, scope.customerId, receipt.versionId ?? props.selectedVersionId)
      router.push(href); router.refresh()
    },
  })
  function run(kind: Command['kind'], extra: Record<string, unknown> = {}) {
    setMessage('')
    const revision = kind === 'decision' ? {} : { expectedRevision: scope.revision }
    return operation.run({ kind, input: { companyId: scope.companyId, profileId: props.actorProfileId,
      quoteId: scope.quoteId, operationId: crypto.randomUUID(), ...revision, ...extra } })
  }
  async function copy() {
    if (!shareUrl) return
    try { await navigator.clipboard.writeText(new URL(shareUrl, window.location.origin).href); setMessage('Odkaz na vybranou verzi je zkopírovaný.') }
    catch { setMessage('Odkaz můžete zkopírovat po otevření vybrané online verze.') }
  }
  return <div className={styles.stack}>
    {operation.error ? <p role="alert" className={styles.error}>{operation.error}</p> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {operation.pending ? <p role="status" className={styles.notice}>{operation.pending.receipt ? 'Operace je potvrzená; otevřete výsledek v původní firmě.' : 'Čekáme na potvrzení uloženého požadavku. Jeho opakování nevytvoří další verzi.'}</p> : null}
    {operation.retryAvailable ? <button type="button" className={styles.primary} onClick={() => operation.run()}>{operation.pending?.receipt ? 'Otevřít potvrzený výsledek' : 'Ověřit stejný požadavek'}</button> : null}
    <div className={styles.actions}>
      {isDraft && !props.workspace.archivedAt ? <>
        <Link className={styles.primary} href={baseHref + '/edit'}>Upravit koncept</Link>
        <button type="button" className={styles.button} disabled={operation.locked} onClick={() => run('publish')}>Vydat a zpřístupnit verzi</button>
        {scope.sourceCalculationId && scope.currentCalculationRevision ? <button type="button" className={styles.button} disabled={operation.locked}
          onClick={() => run('sync', { calculationId: scope.sourceCalculationId, expectedCalculationRevision: scope.currentCalculationRevision })}>Převzít položky z kalkulace</button> : null}
      </> : null}
      {!props.workspace.draftOpen && (version || isLegacyBaseline) && !props.workspace.archivedAt ? <button type="button" className={styles.primary} disabled={operation.locked} onClick={() => run('openRevision', { versionId: version?.versionId ?? null })}>Připravit novou verzi</button> : null}
      {props.workspace.draftOpen && !isDraft ? <Link className={styles.button} href={baseHref + '?version=draft'}>Otevřít rozpracovaný koncept</Link> : null}
      <a className={styles.button} href={`/api/quotes/${scope.quoteId}/pdf${version ? '?versionId=' + encodeURIComponent(version.versionId) : isDraft ? '?draftRevision=' + encodeURIComponent(scope.revision) : '?legacy=1'}`} target="_blank" rel="noreferrer">{isDraft ? 'Náhled PDF' : 'Stáhnout PDF této verze'}</a>
      {shareUrl ? <><a className={styles.button} href={shareUrl} target="_blank" rel="noreferrer">Otevřít online verzi</a><button type="button" className={styles.button} onClick={copy}>Kopírovat odkaz</button></> : null}
      {version && !props.workspace.archivedAt ? <>
        <button type="button" className={styles.button} disabled={operation.locked} onClick={() => setShowSend(value => !value)}>Odeslat tuto verzi</button>
        {version.status === 'published' ? <button type="button" className={styles.button} disabled={operation.locked} onClick={() => setShowDecision(value => !value)}>Zaznamenat rozhodnutí</button> : null}
        <button type="button" className={styles.button} disabled={operation.locked || version.status !== 'accepted'} title={version.status !== 'accepted' ? 'Nejdříve zaznamenejte přijetí této konkrétní verze.' : undefined} onClick={() => setShowConversion(true)}>Vytvořit zakázku z této verze</button>
      </> : null}
      {((version && version.shareToken !== null) || (props.selectedKind === 'legacy' && props.workspace.legacy && props.workspace.legacy.revokedAt === null)) ? <button type="button" className={styles.danger} disabled={operation.locked} onClick={async () => {
        if (window.confirm('Zneplatnit veřejný odkaz této verze? Její obsah zůstane v historii a odkazy ostatních verzí zůstanou beze změny.')) await run('revoke', { versionId: version?.versionId ?? null })
      }}>Zneplatnit odkaz této verze</button> : null}
      {!props.workspace.archivedAt ? <button type="button" className={styles.button} disabled={operation.locked} onClick={() => { if (window.confirm('Archivovat nabídku? Historie a vydané verze zůstanou uložené.')) void run('archive') }}>Archivovat nabídku</button> : null}
    </div>
    {showDecision && version ? <form className={styles.card} onSubmit={async event => {
      event.preventDefault()
      const date = new Date(decidedAt)
      if (!Number.isFinite(date.getTime())) { setMessage('Vyplňte platný čas rozhodnutí.'); return }
      await run('decision', { versionId: version.versionId, decision, evidence, decidedAt: date.toISOString() })
    }}>
      <h2>Ruční záznam rozhodnutí · verze {version.versionNumber}</h2>
      <p className={styles.muted}>Uložíme autora, čas a doložení. Tento záznam není elektronický podpis zákazníka.</p>
      <fieldset disabled={operation.locked} style={{ border: 0, padding: 0, margin: '16px 0' }} className={styles.stack}>
        <div className={styles.grid}><label className={styles.field}>Rozhodnutí<select id="quote-decision" value={decision} onChange={e => setDecision(e.target.value as 'accepted' | 'rejected')}><option value="accepted">Přijato</option><option value="rejected">Odmítnuto</option></select></label>
          <label className={styles.field}>Kdy zákazník rozhodl<input id="quote-decided-at" type="datetime-local" required value={decidedAt} onChange={e => setDecidedAt(e.target.value)} /></label></div>
        <label className={styles.field}>Doložení rozhodnutí<textarea id="quote-decision-evidence" required maxLength={10000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Např. e-mail zákazníka ze dne… nebo zápis z telefonátu…" /></label>
        <button className={styles.primary} type="submit">Uložit rozhodnutí této verze</button>
      </fieldset>
    </form> : null}
    {showSend && version ? <QuoteSendForm companyId={scope.companyId} profileId={props.actorProfileId} quoteId={scope.quoteId} versionId={version.versionId} versionNumber={version.versionNumber} title={props.quoteTitle} contactEmail={props.contactEmail} shareUrl={shareUrl} /> : null}
    {showConversion && version ? <QuoteConversionDialog companyId={scope.companyId} actorProfileId={props.actorProfileId} quoteId={scope.quoteId} customerId={scope.customerId}
      versionId={version.versionId} quoteTitle={props.quoteTitle} description={props.description} contactName={props.contactName} contactEmail={props.contactEmail} shareUrl={shareUrl} onClose={() => setShowConversion(false)} /> : null}
  </div>
}
