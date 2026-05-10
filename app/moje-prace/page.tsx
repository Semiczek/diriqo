import DashboardShell from '@/components/DashboardShell'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

import WorkerFlowClient, { type WorkerJobCard } from './WorkerFlowClient'

type AssignmentRow = {
  id: string
  job_id: string | null
  status: string | null
  completed_at: string | null
  work_completed_at: string | null
  jobs?:
    | {
        id: string
        company_id: string | null
        title: string | null
        address: string | null
        start_at: string | null
        end_at: string | null
        status: string | null
      }
    | {
        id: string
        company_id: string | null
        title: string | null
        address: string | null
        start_at: string | null
        end_at: string | null
        status: string | null
      }[]
    | null
}

type ShiftRow = {
  id: string
  job_id: string | null
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export default async function MyWorkPage() {
  const access = await requireWorkerAccess()

  if (!access.ok) {
    return (
      <DashboardShell activeItem="jobs">
        <main style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
          <section style={{ padding: 18, borderRadius: 16, border: '1px solid #fecaca', background: '#fef2f2' }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>Moje práce</h1>
            <p style={{ margin: '8px 0 0', color: '#991b1b' }}>{access.error}</p>
          </section>
        </main>
      </DashboardShell>
    )
  }

  const supabase = await createSupabaseServerClient()
  const { companyId, profileId } = access.value

  const [assignmentsResponse, openShiftsResponse] = await Promise.all([
    supabase
      .from('job_assignments')
      .select(
        `
          id,
          job_id,
          status,
          completed_at,
          work_completed_at,
          jobs!inner (
            id,
            company_id,
            title,
            address,
            start_at,
            end_at,
            status
          )
        `,
      )
      .eq('profile_id', profileId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('work_shifts')
      .select('id, job_id')
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .is('ended_at', null),
  ])

  const openShiftByJob = new Map<string, string>()
  for (const shift of ((openShiftsResponse.data ?? []) as ShiftRow[])) {
    if (shift.job_id) {
      openShiftByJob.set(shift.job_id, shift.id)
    }
  }

  const jobs: WorkerJobCard[] = (((assignmentsResponse.data ?? []) as unknown) as AssignmentRow[])
    .map((assignment) => {
      const job = asSingle(assignment.jobs)

      if (!assignment.job_id || !job?.id || job.company_id !== companyId) {
        return null
      }

      return {
        assignmentId: assignment.id,
        jobId: job.id,
        title: job.title?.trim() || 'Zakázka bez názvu',
        address: job.address?.trim() || null,
        startAt: job.start_at,
        endAt: job.end_at,
        status: job.status,
        assignmentStatus: assignment.status,
        completedAt: assignment.completed_at ?? assignment.work_completed_at,
        openShiftId: openShiftByJob.get(job.id) ?? null,
      }
    })
    .filter((value): value is WorkerJobCard => Boolean(value))
    .sort((left, right) => {
      const leftTime = left.startAt ? new Date(left.startAt).getTime() : Number.MAX_SAFE_INTEGER
      const rightTime = right.startAt ? new Date(right.startAt).getTime() : Number.MAX_SAFE_INTEGER
      return leftTime - rightTime
    })

  return (
    <DashboardShell activeItem="jobs">
      <main style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
        <section
          style={{
            display: 'grid',
            gap: 8,
            padding: 18,
            borderRadius: 16,
            border: '1px solid #e5e7eb',
            background: '#ffffff',
          }}
        >
          <div style={{ color: '#64748b', fontSize: 13, fontWeight: 850 }}>Moje směna</div>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Moje práce</h1>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
            Start, stop, fotka a hotovo pro přiřazené zakázky v aktivní firmě.
          </p>
          {assignmentsResponse.error || openShiftsResponse.error ? (
            <div style={{ padding: 12, borderRadius: 12, background: '#fef2f2', color: '#b91c1c', fontWeight: 750 }}>
              Data se nepodařilo načíst.
            </div>
          ) : null}
        </section>

        <WorkerFlowClient jobs={jobs} />
      </main>
    </DashboardShell>
  )
}
