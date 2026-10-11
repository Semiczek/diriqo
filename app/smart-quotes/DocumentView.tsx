import { money, type PublicSnapshot } from '@/lib/smart-quotes/domain'
import styles from './quotes.module.css'

export default function DocumentView({ snapshot, version }: { snapshot:PublicSnapshot; version:number }) {
  return <div className={styles.stack}>
    <header className={styles.card}><p className={styles.muted}>{snapshot.supplierName} · Nabídka, verze {version}</p><h1>{snapshot.title}</h1><p>Pro: <strong>{snapshot.customerName}</strong></p><p className={styles.muted}>Platnost do {new Date(`${snapshot.validUntil}T12:00:00Z`).toLocaleDateString('cs-CZ',{ timeZone:'UTC' })} · Měna CZK</p>{snapshot.deliveryTerms && <p className={styles.pre}>{snapshot.deliveryTerms}</p>}</header>
    {snapshot.variants.map(v=><section className={styles.card} key={v.id}><div className={styles.row}><h2>{v.name}</h2>{v.discountPercent>0 && <span className={styles.badge}>Sleva {v.discountPercent} %</span>}</div>
      {v.items.map(i=><div className={styles.publicItem} key={i.id}><div><h3>{i.name}</h3>{i.description && <p className={styles.pre}>{i.description}</p>}<p className={styles.muted}>{i.quantity.toLocaleString('cs-CZ')} {i.unit} × {money(i.unitPrice)} bez DPH · DPH {i.vatRate} %</p></div><strong>{money(i.total)}</strong></div>)}
      <div className={styles.totals}><span className={styles.muted}>Bez DPH<strong>{money(v.net)}</strong></span><span className={styles.muted}>DPH<strong>{money(v.vat)}</strong></span><span className={styles.muted}>Celkem s DPH<strong>{money(v.total)}</strong></span></div>
    </section>)}
    {snapshot.terms && <section className={styles.card}><h2>Podmínky nabídky</h2><p className={styles.pre}>{snapshot.terms}</p></section>}
  </div>
}
