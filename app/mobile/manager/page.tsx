import type { Metadata } from 'next'
import Link from 'next/link'
import { getCompanyRoleLabel, hasHubAccessRole } from '@/lib/hub-access'
import MobileShell from '../MobileShell'
import { publicMobileContext, readManagerMobileOverview } from '../data'
import styles from '../mobile.module.css'

export const metadata: Metadata = { title: 'Diriqo Manager' }
const statusNames: Record<string, string> = { planned: 'Naplánováno', scheduled: 'Naplánováno', in_progress: 'Probíhá', waiting_check: 'Čeká na kontrolu', done: 'Dokončeno', completed: 'Dokončeno', cancelled: 'Zrušeno', ready_for_invoice: 'K fakturaci' }
function date(value: string | null, timeZone: string) { return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }) : 'Bez termínu' }
const modules = [{ product: 'inventory', href: '/inventory', title: 'Sklad', detail: 'Zásoby a pohyby' }, { product: 'fleet', href: '/fleet', title: 'Vozidla', detail: 'Jízdy a provoz' }, { product: 'smart_quotes', href: '/smart-quotes', title: 'Chytré nabídky', detail: 'Příprava nabídek' }, { product: 'ai_assistant', href: '/diriqent', title: 'Diriqent', detail: 'Firemní AI asistent' }, { product: 'pos', href: '/pos', title: 'DiriPOS', detail: 'Pokladna' }]

export default async function ManagerDiriqoPage() {
  let overview
  try { overview = await readManagerMobileOverview() }
  catch (error) { return <MobileShell app="manager"><h1>Diriqo Manager</h1><p className={styles.error} role="alert">{error instanceof Error ? error.message : 'Přehled nyní není dostupný.'}</p><Link href="/mobile/my" className={styles.button}>Otevřít My Diriqo</Link></MobileShell> }
  const { context, names } = overview
  const admin = hasHubAccessRole(context.role)
  const linkedModules = modules.filter(module => overview.products.includes(module.product))
  return <MobileShell app="manager" context={publicMobileContext(context)}>
    <section className={styles.hero}><h1>Dobrý přehled.<br />Klidnější den.</h1><p>Zakázky, tým a práce, která právě běží. Vše z aktivní firmy.</p></section>
    <div className={styles.stats}>
      <div className={styles.stat}><strong>{overview.jobCount}</strong><span>Zakázek celkem</span></div>
      <div className={styles.stat}><strong>{overview.memberCount}</strong><span>Aktivních členů</span></div>
      <div className={styles.stat}><strong>{overview.shiftCount}</strong><span>Běžících směn</span></div>
    </div>
    <section className={styles.section}><h2>Právě v práci</h2>{overview.shifts.length ? overview.shifts.map(shift => <article key={shift.id} className={styles.card}><span className={styles.badge}>Směna běží</span><strong>{names.get(shift.profile_id) || 'Člen týmu'}</strong><p>{overview.jobs.find(job => job.id === shift.job_id)?.title || 'Probíhající práce'} · od {date(shift.started_at, context.timeZone)}</p></article>) : <div className={styles.card}><p>Právě neběží žádná směna.</p></div>}{overview.shiftCount > 100 && <p className={styles.note}>Zobrazeno prvních 100 běžících směn.</p>}</section>
    {linkedModules.length > 0 && <section className={styles.section}><h2>Firemní moduly</h2><div className={styles.links}>{linkedModules.map(module => <Link href={module.href} key={module.product} className={styles.module}>{module.title}<small>{module.detail}</small></Link>)}</div></section>}
    <section className={styles.section}><h2>Poslední zakázky</h2>{overview.jobCount > 100 && <p className={styles.note}>Zobrazeno 100 naposledy založených zakázek z {overview.jobCount}.</p>}{overview.jobs.length ? overview.jobs.map(job => <details key={job.id} className={styles.card}><summary><strong>{job.title || 'Zakázka bez názvu'}</strong></summary><span className={styles.badge}>{statusNames[job.status ?? ''] || 'Bez stavu'}</span><p>{date(job.start_at, context.timeZone)}</p>{job.address && <p>{job.address}</p>}{admin && <Link href={`/jobs/${job.id}`} className={styles.button}>Otevřít zakázku</Link>}</details>) : <div className={styles.card}><p>V této firmě zatím nejsou zakázky.</p></div>}</section>
    <section className={styles.section}><h2>Tým</h2>{overview.members.map(member => <article key={member.id} className={styles.card}><strong>{names.get(member.profile_id) || 'Člen týmu'}</strong><p>{getCompanyRoleLabel(member.role)}</p></article>)}{overview.memberCount > 100 && <p className={styles.note}>Zobrazeno prvních 100 aktivních členů.</p>}</section>
    <div className={styles.links}><Link href="/labor" className={styles.module}>Schvalování práce<small>Výkazy týmu, vrácení a opravy hodin</small></Link><Link href="/mobile/my" className={styles.module}>Moje práce<small>Vlastní směny a zakázky</small></Link>{admin && <Link href="/" className={styles.module}>Správa firmy<small>Úplný webový přehled</small></Link>}</div>
  </MobileShell>
}
