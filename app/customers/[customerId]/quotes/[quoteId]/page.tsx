import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import QuoteActionsPanel from '@/components/QuoteActionsPanel'
import EntityCommunicationTimeline from '@/components/EntityCommunicationTimeline'
import styles from '@/components/QuoteLifecycle.module.css'
import { quoteDetailHref } from '@/components/quote-lifecycle-state'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCoreQuoteWorkspace, getCoreQuoteVersion, getCoreQuoteDraftDocument } from '@/lib/dal/quotes'
import { listEntityThreadMessages } from '@/lib/email/listEntityThreadMessages'
import { QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL } from '@/lib/quote-customer-identity'
import type { CoreQuoteDocumentRead } from '@/lib/core-quote-lifecycle'

type Props = { params: Promise<{ customerId: string; quoteId: string }>; searchParams?: Promise<{ version?: string }> }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function money(value: string | null, currency: string | null) { return value == null ? 'Neznámá částka' : value.replace('.', ',') + (currency ? ' ' + currency : '') }
const responseLabels: Record<string, string> = { interested: 'Zájem o nabídku', contact_requested: 'Žádost o kontakt', revision_requested: 'Požadavek na úpravu', not_interested: 'Bez zájmu' }
const labels: Record<string, string> = { published: 'Vydaná', accepted: 'Přijatá', rejected: 'Odmítnutá', superseded: 'Nahrazená', revoked: 'Odvolaná', draft: 'Koncept' }
export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { customerId, quoteId } = await params
  const requested = (await searchParams)?.version
  const active = await getActiveCompanyContext({ allowedRoles: ['company_admin', 'super_admin', 'manager'] })
  if (!active) return <DashboardShell activeItem="quotes"><main className={styles.shell}><p>Nabídka není pro aktuální firmu nebo roli dostupná.</p></main></DashboardShell>
  const supabase = await createSupabaseServerClient()
  const ctx = { supabase, companyId: active.companyId, profileId: active.profileId, role: active.role }
  let workspace, selected: CoreQuoteDocumentRead
  let selectedVersionId: string | null = null
  try {
    workspace = await getCoreQuoteWorkspace(ctx, quoteId)
    if (!workspace || (customerId && workspace.customerId !== customerId)) throw new Error()
    const selection = requested ?? (workspace.draftOpen ? 'draft' : workspace.currentVersionId ?? 'legacy')
    if (selection === 'draft') {
      if (!workspace.draftOpen) throw new Error()
      selected = await getCoreQuoteDraftDocument(ctx, quoteId, workspace.revision)
    } else if (selection === 'legacy') {
      if (!workspace.legacy) throw new Error()
      selected = { kind: 'legacy', publishedAt: null, legacyCapturedAt: workspace.legacy.capturedAt, status: 'legacy', acceptedAt: null, rejectedAt: null, document: workspace.legacy.document }
    } else {
      if (!workspace.versions.some(version => version.versionId === selection)) throw new Error()
      selectedVersionId = selection
      selected = await getCoreQuoteVersion(ctx, quoteId, selection)
    }
  } catch {
    return <DashboardShell activeItem="quotes"><main className={styles.shell}><div className={styles.error}>Nabídku nebo vybranou verzi nelze načíst. Obnovte stránku a ověřte aktivní firmu.</div><Link href="/cenove-nabidky" className={styles.button}>Zpět na nabídky</Link></main></DashboardShell>
  }
  const document = selected.document
  const base = quoteDetailHref(quoteId, workspace.customerId)
  const selectedSummary = workspace.versions.find(version => version.versionId === selectedVersionId)
  const versionResponses = workspace.responses.filter(response => response.versionId === selectedVersionId)
  const [communication, responses, events] = await Promise.all([
    listEntityThreadMessages(supabase, active.companyId, 'offer', quoteId).catch(() => null),
    supabase.from('offer_responses').select('id, action_type, customer_name, note, created_at').eq('company_id', active.companyId).eq('quote_id', quoteId).order('created_at', { ascending: false }).limit(30),
    supabase.from('offer_events').select('id, event_type, created_at').eq('company_id', active.companyId).eq('quote_id', quoteId).order('created_at', { ascending: false }).limit(30),
  ])
  return <DashboardShell activeItem="quotes"><main className={styles.shell}>
    <Link className={styles.button} style={{ justifySelf: 'start' }} href={workspace.customerId ? `/customers/${workspace.customerId}/quotes` : '/cenove-nabidky'}>← Nabídky</Link>
    <header className={styles.header}><div><span className={styles.badge}>{selected.kind === 'draft' ? 'Koncept' : selected.kind === 'legacy' ? 'Starší dokument' : `Verze ${document.version_number} · ${labels[selected.status] ?? selected.status}`}</span>
      <h1>{document.title ?? 'Cenová nabídka'}</h1><p>{document.quote_number ?? ''}{workspace.archivedAt ? ' · Archivováno' : ''}</p>
      <p>{selected.kind === 'draft' ? 'Rozpracované změny jsou oddělené od již vydaných verzí.' : selected.kind === 'legacy' ? 'Dochovaný stav staršího dokumentu. Původní vydaný obsah nemusí být úplný.' : `Vydáno ${date(selected.publishedAt)}`}</p></div>
      <div><span className={styles.muted}>Cena po slevě{document.pricing_mode === 'net' ? ', bez DPH' : ' · cenový režim nedoložen'}</span><div className={styles.total}>{money(document.total_price, document.currency)}</div></div>
    </header>
    <section className={styles.card}><h2>Verze nabídky</h2><div className={styles.actions}>
      {workspace.draftOpen ? <Link className={selected.kind === 'draft' ? styles.primary : styles.button} href={base + '?version=draft'}>Rozpracovaný koncept</Link> : null}
      {workspace.versions.map(version => <Link key={version.versionId} className={version.versionId === selectedVersionId ? styles.primary : styles.button} href={base + '?version=' + encodeURIComponent(version.versionId)}>Verze {version.versionNumber} · {labels[version.status] ?? version.status}</Link>)}
      {workspace.legacy ? <Link className={selected.kind === 'legacy' ? styles.primary : styles.button} href={base + '?version=legacy'}>Dochovaná historie</Link> : null}
    </div></section>
    <section className={styles.card}><QuoteActionsPanel key={[active.companyId, active.profileId, quoteId, workspace.revision, selectedVersionId ?? selected.kind].join(':')}
      workspace={workspace} actorProfileId={active.profileId} selectedVersionId={selectedVersionId} selectedKind={selected.kind} quoteTitle={document.title ?? ''}
      contactName={document.content.contact_name} contactEmail={document.content.contact_email} description={document.content.work_description ?? document.content.proposed_solution} /></section>
    {selectedSummary?.decision ? <section className={styles.card}><h2>Zaznamenané rozhodnutí této verze</h2>
      <p><strong>{selectedSummary.decision.decision === 'accepted' ? 'Přijato' : 'Odmítnuto'}</strong> · rozhodnutí {date(selectedSummary.decision.decidedAt)}</p>
      <p className={styles.muted}>Zapsáno {date(selectedSummary.decision.recordedAt)} · autor {selectedSummary.decision.actorId} · {selectedSummary.decision.actorKind === 'manual' ? 'ruční záznam' : selectedSummary.decision.actorKind}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{selectedSummary.decision.evidence}</p>
    </section> : null}
    <section className={styles.card}><div className={styles.grid}><div><h2>Zákazník</h2>
      {document.customer_identity_state === 'legacy_unknown' ? <p role="status" className={styles.notice}>{QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL}</p> : <>
        <strong>{document.customer.billing_name ?? document.customer.name ?? 'Bez zákazníka'}</strong>
        <p className={styles.muted}>{[document.customer.billing_street, document.customer.billing_postal_code, document.customer.billing_city, document.customer.billing_country].filter(Boolean).join(', ')}</p>
        <p className={styles.muted}>{document.customer.company_number ? `IČO ${document.customer.company_number}` : ''}{document.customer.vat_number ? ` · DIČ ${document.customer.vat_number}` : ''}</p>
      </>}
    </div><div><h2>Podmínky dokumentu</h2><p>Datum: {document.quote_date ?? 'Nedoloženo'}</p><p>Platnost do: {document.valid_until ?? 'Neuvedena'}</p><p>Cenový režim: {document.pricing_mode === 'net' ? 'Bez DPH; sazba je uvedena u položky' : 'Nedoložen'}</p></div></div></section>
    <section className={styles.card}><h2>Položky nabídky</h2>
      {!document.items.length ? <p className={styles.notice}>Položky tohoto dokumentu nejsou uložené. Současnou kalkulací je nenahrazujeme.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Položka</th><th>Množství</th><th>Cena za jednotku</th><th>DPH</th><th>Celkem bez DPH</th></tr></thead><tbody>
        {document.items.map(item => <tr key={item.id}><td><strong>{item.name ?? 'Neznámá položka'}</strong>{item.description ? <p>{item.description}</p> : null}{item.note ? <p className={styles.muted}>{item.note}</p> : null}</td><td>{item.quantity} {item.unit}</td><td>{money(item.unit_price, document.currency)}</td><td>{item.vat_rate === null ? 'Nedoloženo' : item.vat_rate + ' %'}</td><td>{money(item.total_price, document.currency)}</td></tr>)}
      </tbody></table></div>}
      <div style={{ textAlign: 'right', marginTop: 20 }}><p>Mezisoučet: {money(document.subtotal_price, document.currency)}</p><p>Sleva: {money(document.discount_amount, document.currency)}</p><strong>Celkem: {money(document.total_price, document.currency)}</strong></div>
    </section>
    {[
      ['Úvod', document.content.intro_text], [document.content.customer_request_title ?? 'Zadání zákazníka', document.content.customer_request],
      [document.content.our_solution_title ?? 'Navržené řešení', document.content.proposed_solution], ['Přínosy', document.content.benefits_text],
      ['Popis práce', document.content.work_description], [document.content.timeline_title ?? 'Harmonogram', document.content.work_schedule],
      [document.content.pricing_title ?? 'Cena', document.content.pricing_text], [document.content.payment_terms_title ?? 'Platební podmínky', document.content.payment_terms],
      ['Poznámka pro zákazníka', document.customer_note],
    ].filter(([, content]) => content).map(([title, content], index) => <section key={index} className={styles.card}><h2>{title}</h2><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{content}</p></section>)}
    {selected.kind === 'draft' && workspace.draft.internal_note ? <section className={styles.card}><h2>Interní poznámka</h2><p style={{ whiteSpace: 'pre-wrap' }}>{workspace.draft.internal_note}</p></section> : null}
    {workspace.sourceCalculationId ? <section className={styles.card}><h2>Zdrojová kalkulace</h2><p>Naposledy převzatá revize kalkulace: {workspace.sourceCalculationRevision ?? 'nedoložena'}. Aktuální revize zdroje: {workspace.currentCalculationRevision ?? 'nedostupná'}.</p><Link className={styles.button} href={`/kalkulace/${workspace.sourceCalculationId}`}>Otevřít kalkulaci</Link></section> : null}
    {communication ? <EntityCommunicationTimeline entityType="offer" entityId={quoteId} title="E-mailová komunikace k nabídce" feedItems={communication.feedItems} /> : <p className={styles.notice}>E-mailovou historii se nepodařilo načíst.</p>}
    {selectedVersionId ? <section className={styles.card}><h2>Reakce k této verzi</h2>
      <p className={styles.muted}>Zobrazujeme nejnovější reakce nabídky (nejvýše 200), filtrované podle vybrané verze.</p>
      {versionResponses.length ? <div className={styles.stack}>{versionResponses.map(response => <article key={response.responseId} className={styles.item}>
        <div><strong>{responseLabels[response.actionType] ?? response.actionType}</strong> · {date(response.recordedAt)}</div>
        <p className={styles.muted}>{response.actorKind === 'portal' ? 'Přihlášený zákazník v portálu' : 'Odpověď přes veřejný odkaz'}{response.actorId ? ' · autor ' + response.actorId : ''}</p>
        {response.customerName ? <p>{response.customerName}</p> : null}
        {response.customerEmail || response.customerPhone ? <p>{[response.customerEmail, response.customerPhone].filter(Boolean).join(' · ')}</p> : null}
        {response.note ? <p style={{ whiteSpace: 'pre-wrap' }}>{response.note}</p> : null}
      </article>)}</div> : <p>Mezi nejnovějšími reakcemi není žádná k této verzi.</p>}
    </section> : null}
    <section className={styles.card}><h2>Starší reakce bez vazby na vydanou verzi</h2>
      <p className={styles.muted}>Dřívější události zůstávají zachované. Nejde o potvrzení aktuálně vybrané verze.</p>
      {responses.error || events.error ? <p className={styles.notice}>Část dřívější historie se nepodařilo načíst.</p> : null}
      {(responses.data ?? []).map(response => <p key={response.id}><strong>{response.customer_name}</strong> · {response.action_type} · {date(response.created_at)}{response.note ? ' — ' + response.note : ''}</p>)}
      {(events.data ?? []).map(event => <p key={event.id} className={styles.muted}>{event.event_type} · {date(event.created_at)}</p>)}
      {!responses.error && !events.error && !responses.data?.length && !events.data?.length ? <p className={styles.muted}>Zatím bez uložené události.</p> : null}
    </section>
  </main></DashboardShell>
}
