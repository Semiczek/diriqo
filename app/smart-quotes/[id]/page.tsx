import Link from 'next/link'
import { quoteError, readWorkspace } from '@/lib/smart-quotes/server'
import { money, variantTotals } from '@/lib/smart-quotes/domain'
import { QuoteFrame, QuoteUnavailable, ReadOnlyNotice, statusLabel } from '../Frame'
import QuoteControls from './QuoteControls'
import DocumentView from '../DocumentView'
import styles from '../quotes.module.css'

export default async function SmartQuoteDetailPage({ params }: { params:Promise<{id:string}> }) {
  const { id }=await params
  let data
  try { data=await readWorkspace(id) } catch(error) { return <QuoteUnavailable message={quoteError(error)} /> }
  const q=data.quote!
  return <QuoteFrame title={q.draft.title} action={<span className={styles.badge}>{statusLabel(q.status)}</span>}>
    {!data.canWrite && <ReadOnlyNotice />}
    <section className={styles.card}><div className={styles.row}><div><h2>{q.draft.customerName}</h2><p className={styles.muted}>Revize návrhu {q.revision} · {q.current_version ? `Vydaná verze ${q.current_version}` : 'Zatím nevydáno'}</p></div><Link className={styles.secondary} href={`/smart-quotes/${id}/export`}>Export JSON</Link></div>
      {q.current_version>0 && q.published_revision!==q.revision && <p className={styles.notice}>Návrh obsahuje nevydané změny. Zákazník stále vidí poslední vydanou verzi.</p>}
      <h3>Poslední uložený návrh</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Varianta</th><th>Cena s DPH</th><th>Plánovaný náklad</th><th>Marže</th></tr></thead><tbody>{q.draft.variants.map(v=>{ const t=variantTotals(v); return <tr key={v.id}><td>{v.name}</td><td>{money(t.total)}</td><td>{money(t.cost)}</td><td>{t.margin.toLocaleString('cs-CZ')} %</td></tr> })}</tbody></table></div>
      <p className={styles.muted}>Náklady jsou pouze kalkulační. Do skutečných nákladů zakázky se z této nabídky nepřenášejí.</p>
    </section>
    {data.acceptance && <section className={styles.card}><h2>Přijetí zákazníkem</h2><p>Verze {data.acceptance.version} · {data.versions?.find(v=>v.version===data.acceptance!.version)?.snapshot.variants.find(v=>v.id===data.acceptance!.variant_id)?.name}</p><p className={styles.muted}>{data.acceptance.name} · {data.acceptance.email}<br />{new Date(data.acceptance.accepted_at).toLocaleString('cs-CZ',{ timeZone:'Europe/Prague' })}</p><p className={styles.muted}>Přijetí přes soukromý odkaz s uvedeným jménem a e-mailem. Totožnost nebyla samostatně ověřována.</p>{data.conversion && !data.canWrite && <Link className={styles.secondary} href={`/jobs/${data.conversion.job_id}`}>Otevřít zakázku</Link>}</section>}
    {data.canWrite && <QuoteControls key={`${data.companyId}:${q.id}`} companyId={data.companyId} quote={q} acceptance={data.acceptance} conversion={data.conversion} canConvert={data.canConvert} />}
    {!!data.rejections?.length && <details className={`${styles.card} ${styles.details}`}><summary>Historie odmítnutí</summary>{data.rejections.map(r=><p key={r.version} className={styles.muted}>Verze {r.version} · {r.name} · {r.email} · {new Date(r.rejected_at).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}</p>)}</details>}
    <section className={`${styles.card} ${styles.stack}`}><h2>Vydané verze</h2>{data.versions?.length ? data.versions.map(v=><details key={v.version} className={styles.details}><summary>Verze {v.version}{v.version===q.current_version?' · aktuální':' · nahrazená'} · {new Date(v.published_at).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}</summary><div className={styles.stack}><div className={styles.actions}><Link className={styles.secondary} href={`/smart-quotes/${id}/export?version=${v.version}`}>Export této verze</Link><Link className={styles.secondary} href={`/smart-quotes/${id}/print?version=${v.version}`} target="_blank">Tisk / PDF</Link></div><DocumentView snapshot={v.snapshot} version={v.version} /></div></details>) : <p className={styles.muted}>Návrh zatím nemá vydanou verzi. Po vydání už její obsah nepůjde přepsat.</p>}</section>
  </QuoteFrame>
}
