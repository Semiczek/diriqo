import type { Metadata } from 'next'
import Link from 'next/link'
import WorkerFlowClient from '@/app/moje-prace/WorkerFlowClient'
import MobileShell from '../MobileShell'
import { publicMobileContext, readMyMobileWork } from '../data'
import styles from '../mobile.module.css'

export const metadata: Metadata = { title: 'My Diriqo' }

export default async function MyDiriqoPage() {
  let work
  try { work = await readMyMobileWork() }
  catch (error) { return <MobileShell app="my"><h1>My Diriqo</h1><p className={styles.error} role="alert">{error instanceof Error ? error.message : 'Přehled nyní není dostupný.'}</p><Link href="/mobile/my/finish" className={styles.button}>Ukončit rozpracovanou směnu</Link><Link href="/sign-in">Přejít k přihlášení</Link></MobileShell> }
  const running = work.openShiftCount
  return <MobileShell app="my" context={publicMobileContext(work.context)}>
    <section className={styles.hero}><h1>Vše pro vaši práci.</h1><p>{running ? 'Směna běží. Po práci ji ukončete a předejte zakázku ke kontrole.' : 'Vyberte přiřazenou zakázku, spusťte směnu a můžete začít.'}</p></section>
    <div className={styles.stats}>
      <div className={styles.stat}><strong>{work.total}</strong><span>Přiřazených zakázek</span></div>
      <div className={styles.stat}><strong>{running}</strong><span>Běžících směn</span></div>
      <div className={styles.stat}><strong>{work.jobs.filter(job => job.completedAt).length}</strong><span>Hotovo v přehledu</span></div>
    </div>
    {running > 0 && <Link href="/mobile/my/finish" className={styles.module}>Všechny moje rozpracované směny<small>Zastavit běžící práci</small></Link>}
    <Link href="/labor" className={styles.module}>Pracovní výkazy<small>Odeslat odpracované hodiny a sledovat schválení</small></Link>
    <Link href="/mobile/my/advances" className={styles.module}>Moje zálohy<small>Žádost, rozhodnutí a historie výplat</small></Link>
    <section className={styles.section}><h2>Moje zakázky</h2>{work.total > 100 && <p className={styles.note}>Posledních 100 přiřazení z {work.total} a starší rozpracované zakázky. Všechny běžící směny najdete také v samostatném přehledu výše.</p>}<WorkerFlowClient jobs={work.jobs} timeZone={work.context.timeZone} /></section>
  </MobileShell>
}
