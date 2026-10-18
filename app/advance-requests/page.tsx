import DashboardShell from '@/components/DashboardShell'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { readAdvances } from '@/lib/dal/worker-advances'
import { formatDateKeyInTimeZone } from '@/lib/date/prague-time'
import AdvanceOverview from './AdvanceOverview'
import styles from './advances.module.css'

export default async function AdvanceRequestsPage() {
  const access = await requireWorkerAccess()
  if (!access.ok || !['company_admin', 'super_admin'].includes(access.value.role ?? '')) {
    return <DashboardShell activeItem="advanceRequests"><p role="alert">Přehled firemních záloh je dostupný správci aktivní firmy.</p></DashboardShell>
  }
  const context = { ...access.value, supabase: await createSupabaseServerClient() }
  let data
  try { data = await readAdvances(context) }
  catch { return <DashboardShell activeItem="advanceRequests"><p role="alert">Přehled záloh se nepodařilo načíst. Obnovte stránku.</p></DashboardShell> }
  return <DashboardShell activeItem="advanceRequests"><main className={styles.page}>
    <header className={styles.header}><h1>Zálohy pracovníků</h1><p>Rozhodnutí, jednotlivé výplaty a zůstatky na jednom místě. Schválení žádosti samo o sobě peníze nevyplácí.</p></header>
    <AdvanceOverview {...data} companyId={context.companyId} actorProfileId={context.profileId} admin today={formatDateKeyInTimeZone(new Date(), context.timeZone)} />
  </main></DashboardShell>
}
