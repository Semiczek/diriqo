import Link from 'next/link'
import MobileShell from '../../MobileShell'
import { publicMobileContext, readMyOpenShifts } from '../../data'
import styles from '../../mobile.module.css'
import FinishShifts from './FinishShifts'

export default async function FinishMyShiftsPage() {
  let work
  try { work = await readMyOpenShifts() }
  catch (error) { return <MobileShell app="my"><p className={styles.error} role="alert">{error instanceof Error ? error.message : 'Směny nyní nejsou dostupné.'}</p><Link href="/sign-in" className={styles.button}>Přejít k přihlášení</Link></MobileShell> }
  return <MobileShell app="my" context={publicMobileContext(work.context)}>
    <section className={styles.hero}><h1>Rozpracované směny</h1><p>Vlastní běžící směnu můžete ukončit i po skončení firemní licence.</p></section>
    {work.total ? <FinishShifts shifts={work.shifts} timeZone={work.context.timeZone} /> : <section className={styles.card}><strong>Všechny směny máte ukončené.</strong><p>Nic dalšího nemusíte potvrzovat.</p></section>}
    {work.total > 100 && <p className={styles.note}>Zobrazeno 100 nejstarších z {work.total} běžících směn. Po jejich ukončení se zobrazí další.</p>}
    <Link href="/mobile/my" className={styles.button}>Zpět na moji práci</Link>
  </MobileShell>
}
