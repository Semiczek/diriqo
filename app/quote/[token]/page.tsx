import type { Metadata } from 'next'
import { readPublicQuote } from '@/lib/smart-quotes/server'
import { acceptanceBlockReason } from '@/lib/smart-quotes/domain'
import DocumentView from '../../smart-quotes/DocumentView'
import PrintButton from '../../smart-quotes/PrintButton'
import AcceptanceForm from './AcceptanceForm'
import styles from '../../smart-quotes/quotes.module.css'

export const dynamic='force-dynamic'
export const metadata:Metadata={title:'Cenová nabídka',robots:{index:false,follow:false},referrer:'no-referrer'}
export default async function PublicSmartQuotePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params
  let quote
  try { quote=await readPublicQuote(token) } catch { return <main className={styles.public}><h1>Nabídku se nepodařilo načíst</h1><p>Zkuste stránku obnovit nebo kontaktujte dodavatele.</p></main> }
  if(!quote) return <main className={styles.public}><h1>Odkaz není dostupný</h1><p>Vyžádejte si od dodavatele nový odkaz na nabídku.</p></main>
  const blocked=acceptanceBlockReason(quote)
  return <main className={`${styles.public} ${styles.printDocument}`}>
    <div className={`${styles.row} ${styles.noPrint}`}><span className={styles.muted}>Nabídka od {quote.snapshot.supplierName}</span><PrintButton/></div>
    <DocumentView snapshot={quote.snapshot} version={quote.version}/>
    {quote.acceptance && <section className={styles.notice}><strong>Nabídka byla přijata</strong><p>Varianta: {quote.snapshot.variants.find(v=>v.id===quote.acceptance!.variantId)?.name}<br/>{quote.acceptance.name} · {new Date(quote.acceptance.acceptedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}</p></section>}
    {!quote.acceptance && (blocked ? <div className={styles.notice}>{blocked}</div> : <AcceptanceForm token={token} version={quote.version} variants={quote.snapshot.variants}/>)}
  </main>
}
