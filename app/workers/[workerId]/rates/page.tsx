import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { listLaborRates } from '@/lib/dal/labor-history'
import type { LaborRateListDto } from '@/lib/labor-history'
import WorkerRatesClient from './WorkerRatesClient'

export default async function WorkerRatesPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = await params
  let data: { schedule: LaborRateListDto; actorProfileId: string } | null = null
  try {
    const ctx = await requireCompanyRoleDalContext('super_admin', 'company_admin')
    data = { schedule: await listLaborRates(ctx, workerId), actorProfileId: ctx.profileId }
  } catch { /* Do not render financial data without a verified company and role. */ }
  if (!data) return <DashboardShell activeItem="workers"><main style={{ padding: 24 }}>
    <h1>Nákladové sazby nejsou dostupné</h1>
    <p>Ověřte aktivní firmu a oprávnění ke správě nákladových sazeb.</p>
    <Link href="/workers">Zpět na pracovníky</Link>
  </main></DashboardShell>
  return <DashboardShell activeItem="workers">
    <WorkerRatesClient key={`${data.schedule.companyId}:${data.actorProfileId}:${workerId}:${data.schedule.revision}`}
      schedule={data.schedule} actorProfileId={data.actorProfileId} />
  </DashboardShell>
}
