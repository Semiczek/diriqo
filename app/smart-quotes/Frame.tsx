import Link from 'next/link'
import styles from './quotes.module.css'

export function QuoteFrame({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className={styles.page}><header className={styles.header}><div><h1>{title}</h1><p>Nabídky s variantami, šablonami a přijetím zákazníkem.</p></div>{action}</header>
    <nav className={styles.nav} aria-label="Chytré nabídky"><Link href="/smart-quotes">Nabídky</Link><Link href="/smart-quotes/templates">Šablony</Link><Link href="/smart-quotes/library">Knihovna položek</Link><Link href="/diriqent/ocr?domain=smart_quotes">Přečíst podklad</Link><Link href="/smart-quotes/export" download prefetch={false}>Export interní knihovny</Link></nav>{children}</div>
}
export function QuoteUnavailable({ message }: { message: string }) {
  return <QuoteFrame title="Chytré nabídky"><div className={styles.notice}>{message}</div><p className={styles.muted}>O zpřístupnění modulu požádejte správce firmy.</p></QuoteFrame>
}
export function ReadOnlyNotice() { return <div className={styles.notice}>Modul je v režimu historie. Nabídky můžete číst a exportovat; pro nové změny aktivujte Chytré nabídky a Diriqo Core.</div> }
export function statusLabel(status: string) { return ({ draft:'Koncept',sent:'Vydaná',accepted:'Přijatá',rejected:'Odmítnutá' } as Record<string,string>)[status] ?? status }
