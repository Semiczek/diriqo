import Link from 'next/link'
import styles from './diriqent.module.css'
export default function AiFrame({title,children}:{title:string;children:React.ReactNode}) {
  return <div className={styles.page}><header><h1>{title}</h1><p className={styles.muted}>Pomoc s vaší prací. Firemní data a rozhovory zůstávají v rozsahu vašich oprávnění.</p></header><nav className={styles.nav} aria-label="Diriqent"><Link href="/diriqent">Asistent</Link><Link href="/diriqent/ocr?domain=smart_quotes">OCR nabídek</Link><Link href="/diriqent/ocr?domain=inventory">OCR skladu</Link><Link href="/diriqent/ocr?domain=invoicing">OCR dokladů</Link></nav>{children}</div>
}
