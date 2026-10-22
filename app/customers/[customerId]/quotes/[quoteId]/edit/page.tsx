import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import QuoteEditForm from '@/components/QuoteEditForm'
import styles from '@/components/QuoteLifecycle.module.css'
import { quoteDetailHref } from '@/components/quote-lifecycle-state'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCoreQuoteWorkspace } from '@/lib/dal/quotes'
import { quoteDraftToInput } from '@/lib/core-quote-lifecycle'

type Props = { params: Promise<{ customerId: string; quoteId: string }> }
export default async function QuoteEditPage({ params }: Props) {
  const { customerId, quoteId } = await params
  const active = await getActiveCompanyContext({ allowedRoles: ['company_admin', 'super_admin', 'manager'] })
  if (!active) return <DashboardShell activeItem="quotes"><main className={styles.shell}><p>Úprava nabídky není pro aktuální firmu nebo roli dostupná.</p></main></DashboardShell>
  const supabase = await createSupabaseServerClient()
  let workspace
  try {
    workspace = await getCoreQuoteWorkspace({ supabase, companyId: active.companyId, profileId: active.profileId, role: active.role }, quoteId)
    if (!workspace || (customerId && customerId !== workspace.customerId)) throw new Error()
  } catch { return <DashboardShell activeItem="quotes"><main className={styles.shell}><p className={styles.error}>Nabídku nelze načíst. Ověřte aktivní firmu a obnovte stránku.</p></main></DashboardShell> }
  const href = quoteDetailHref(quoteId, workspace.customerId)
  if (!workspace.draftOpen || workspace.archivedAt) return <DashboardShell activeItem="quotes"><main className={styles.shell}>
    <p className={styles.notice}>{workspace.archivedAt ? 'Nabídka je archivovaná. Její historie zůstává dostupná.' : 'Vydaný obsah nelze přepsat. Na detailu vyberte verzi a zvolte „Připravit novou verzi“.'}</p><Link className={styles.button} href={href}>Zpět na nabídku</Link>
  </main></DashboardShell>
  const values = quoteDraftToInput(workspace.draft, { companyId: active.companyId, profileId: active.profileId, quoteId, expectedRevision: workspace.revision, operationId: '00000000-0000-4000-8000-000000000000' })
  return <DashboardShell activeItem="quotes"><main className={styles.shell}>
    <Link className={styles.button} style={{ justifySelf: 'start' }} href={href}>← Detail nabídky</Link>
    <header className={styles.header}><div><span className={styles.badge}>Rozpracovaný koncept</span><h1>Upravit nabídku</h1><p>Změny se zákazníkovi zpřístupní až po vydání nové verze.</p></div></header>
    <QuoteEditForm key={[active.companyId, active.profileId, quoteId].join(':')} customerId={workspace.customerId} initialValues={values} />
  </main></DashboardShell>
}
