import Link from 'next/link'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { readAdvances } from '@/lib/dal/worker-advances'
import { formatDateKeyInTimeZone } from '@/lib/date/prague-time'
import MobileShell from '../../MobileShell'
import { publicMobileContext } from '../../data'
import AdvanceOverview from '@/app/advance-requests/AdvanceOverview'
import { AdvanceRequestForm } from '@/app/advance-requests/AdvanceForms'
import styles from '@/app/advance-requests/advances.module.css'

export default async function MyAdvancesPage() {
  const access = await requireWorkerAccess()
  if (!access.ok) return <MobileShell app="my"><p role="alert">Pro své zálohy se přihlaste a vyberte firmu.</p><Link href="/sign-in">Přihlášení</Link></MobileShell>
  const context = { ...access.value, supabase: await createSupabaseServerClient() }
  let data
  try { data = await readAdvances(context, true) }
  catch { return <MobileShell app="my" context={publicMobileContext(context)}><p role="alert">Vaše zálohy se nepodařilo načíst. Obnovte stránku.</p></MobileShell> }
  return <MobileShell app="my" context={publicMobileContext(context)}><main className={styles.page}>
    <header className={styles.header}><Link href="/mobile/my">Zpět na moji práci</Link><h1>Moje zálohy</h1><p>Požádejte o zálohu a sledujte rozhodnutí i jednotlivé výplaty.</p></header>
    <AdvanceRequestForm currency={data.currency} companyId={context.companyId} actorProfileId={context.profileId} />
    <AdvanceOverview {...data} companyId={context.companyId} actorProfileId={context.profileId} today={formatDateKeyInTimeZone(new Date(), context.timeZone)} admin={false} />
  </main></MobileShell>
}
