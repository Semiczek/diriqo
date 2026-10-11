import Link from 'next/link'
import { money } from '@/lib/pos/domain'
import { PosError, readPos } from '@/lib/pos/server'
import type { Receipt } from '@/lib/pos/types'
import PrintButton from './PrintButton'
import styles from './receipt.module.css'

export default async function ReceiptPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ company?: string; register?: string; kind?: string }>
}) {
  const [path, query] = await Promise.all([params, searchParams])
  let receipt: Receipt
  try { receipt = await readPos(query.company ?? '', query.register ?? '', 'receipt', { id: path.id, kind: query.kind === 'return' ? 'return' : 'sale' }) as Receipt }
  catch (error) { return <main className={styles.page}><h1>Doklad nelze zobrazit</h1><p>{error instanceof PosError ? error.message : 'Obnovte přihlášení a zkuste to znovu.'}</p><Link href="/pos">Zpět na pokladnu</Link></main> }
  const document = receipt.document
  const taxes = new Map<number, { gross: number; tax: number }>()
  for (const line of receipt.lines) {
    const rate = Number(line.tax_rate); const group = taxes.get(rate) ?? { gross: 0, tax: 0 }
    group.gross += Number(line.total_minor); group.tax += Number(line.tax_minor); taxes.set(rate, group)
  }
  return <main className={styles.page}>
    <nav className={styles.controls}><Link href="/pos">Zpět na pokladnu</Link><PrintButton /></nav>
    <article className={styles.receipt}>
      <p className={styles.copy}>KOPIE DOKLADU</p>
      <h1>{receipt.kind === 'return' ? 'Vratka' : 'Prodejní doklad'}</h1>
      <strong>{document.document_no}</strong><p>{new Date(document.created_at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}</p>
      <section><h2>{receipt.issuer.name}</h2>{receipt.issuer.address ? <p>{receipt.issuer.address}</p> : null}{receipt.issuer.registration_number ? <p>IČ: {receipt.issuer.registration_number}</p> : null}{receipt.issuer.tax_number ? <p>DIČ: {receipt.issuer.tax_number}</p> : null}</section>
      {receipt.original_document_no ? <p>Původní doklad: {receipt.original_document_no}</p> : null}
      {document.reason ? <p>Důvod: {document.reason}</p> : null}
      <table><thead><tr><th>Položka</th><th>Množství</th><th>DPH</th><th>Celkem</th></tr></thead><tbody>{receipt.lines.map(line => <tr key={line.id}><td>{line.name}</td><td>{Number(line.quantity)} {line.unit}</td><td>{line.tax_rate} %</td><td>{money(line.total_minor)}</td></tr>)}</tbody></table>
      <h2>Daňový rozpis evidovaných cen</h2><table><thead><tr><th>Sazba</th><th>Základ</th><th>DPH</th><th>Včetně DPH</th></tr></thead><tbody>{[...taxes].map(([rate, value]) => <tr key={rate}><td>{rate} %</td><td>{money(value.gross - value.tax)}</td><td>{money(value.tax)}</td><td>{money(value.gross)}</td></tr>)}</tbody></table>
      <p>Součet položek: {money(document.total_minor)}</p><p>Zaokrouhlení: {money(document.paid_minor - document.total_minor)}</p><p className={styles.total}>{receipt.kind === 'return' ? 'Vráceno' : 'Uhrazeno'}: {money(document.paid_minor)}</p>
      <p>{document.payment_method === 'cash' ? 'Hotovost' : 'Externě přijatá platba — ruční evidence, bez potvrzení terminálem'}</p>
      {document.payment_note ? <p>Reference: {document.payment_note}</p> : null}
      {document.tendered_minor !== undefined && document.payment_method === 'cash' ? <p>Přijato: {money(document.tendered_minor)} · Vydáno: {money(document.tendered_minor - document.paid_minor)}</p> : null}
      <p className={styles.footer}>DiriPOS · CZK · Opakovaný tisk nemění prodej, platbu ani sklad.</p>
    </article>
  </main>
}
