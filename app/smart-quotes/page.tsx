import Link from 'next/link'
import { readWorkspace, quoteError } from '@/lib/smart-quotes/server'
import { QuoteFrame, QuoteUnavailable, ReadOnlyNotice, statusLabel } from './Frame'
import styles from './quotes.module.css'

export default async function SmartQuotesPage() {
  let data
  try { data = await readWorkspace() } catch (error) { return <QuoteUnavailable message={quoteError(error)} /> }
  return <QuoteFrame title="Chytré nabídky" action={data.canWrite ? <Link className={styles.primary} href="/smart-quotes/new">Nová nabídka</Link> : undefined}>
    {!data.canWrite && <ReadOnlyNotice />}
    <section className={styles.card} aria-label="Seznam nabídek">
      {data.quotes.length ? data.quotes.map(q => <Link key={q.id} className={styles.listRow} href={`/smart-quotes/${q.id}`}><span><strong>{q.title}</strong><small>{q.customer} · {q.current_version ? `Verze ${q.current_version}` : 'Rozpracováno'}</small></span><span className={styles.badge}>{statusLabel(q.status)}</span></Link>) : <p className={styles.muted}>Zatím tu není žádná chytrá nabídka. Začněte ručně nebo použijte svou šablonu.</p>}
    </section>
  </QuoteFrame>
}
