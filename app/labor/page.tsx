import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { listLaborSourceOptions, listLaborSubmissions } from '@/lib/dal/labor-history'
import { laborHistoryId } from '@/lib/labor-history'
import LaborWorkspaceClient from './LaborWorkspaceClient'
import type { LaborWorkspace } from './workflow'

export default async function LaborPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  let data: LaborWorkspace | null = null
  try {
    const query = await searchParams
    const jobId = query.job === undefined ? undefined : laborHistoryId(query.job)
    const profileId = query.worker === undefined ? undefined : laborHistoryId(query.worker)
    const ctx = await requireCompanyRoleDalContext('worker', 'manager', 'company_admin', 'super_admin')
    const [submissions, sources] = await Promise.all([listLaborSubmissions(ctx, { ...(jobId ? {jobId} : {}), ...(profileId ? {profileId} : {}) }), listLaborSourceOptions(ctx, profileId ? {profileId} : {})])
    data = { companyId: ctx.companyId, actorProfileId: ctx.profileId, companyName: sources.companyName,
      role: ctx.role as LaborWorkspace['role'], items: submissions.items, sources: jobId ? sources.items.filter(source => source.jobId === jobId) : sources.items }
  } catch { /* Never render stale tenant data after authentication or metadata failure. */ }
  if (!data) return <main style={{ padding: 32 }}><h1>Výkazy nejsou dostupné / Timesheets unavailable / Arbeitsnachweise nicht verfügbar</h1><Link href="/mobile/my">Zpět / Back / Zurück</Link></main>
  const workspace = <LaborWorkspaceClient key={`${data.companyId}:${data.actorProfileId}:${data.role}`} workspace={data} />
  if (data.role === 'worker' || data.role === 'manager') return <><nav style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px', background: 'white' }}><Link href={data.role === 'manager' ? '/mobile/manager' : '/mobile/my'}>← {data.role === 'manager' ? 'Manager Diriqo' : 'My Diriqo'}</Link><LanguageSwitcher /></nav>{workspace}</>
  return <DashboardShell activeItem="labor">{workspace}</DashboardShell>
}
