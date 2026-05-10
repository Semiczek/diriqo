import { NextRequest, NextResponse } from 'next/server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RouteContext = {
  params: Promise<{
    jobId: string
  }>
}

type AssignmentInput = {
  id?: string
  profile_id?: string
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | string | null
  note?: string | null
}

type AddAssignmentPayload = {
  profile_id?: string
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | string | null
  note?: string | null
}

type DeleteAssignmentPayload = {
  assignmentId?: string
}

type JobRow = {
  id: string
  company_id: string | null
  parent_job_id: string | null
}

type AssignmentRow = {
  id: string
  company_id?: string | null
  job_id: string
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  note: string | null
}

function toNumber(value: unknown) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeWorkerType(value: unknown) {
  return value === 'contractor' ? 'contractor' : 'employee'
}

function normalizeBillingType(value: unknown) {
  if (value === 'fixed' || value === 'invoice') return value
  if (value === 'hourly') return 'hourly'
  return null
}

function buildAssignmentKey(jobId: string, profileId: string) {
  return `${jobId}:${profileId}`
}

async function loadJobScope(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, companyId: string, jobId: string) {
  const jobResponse = await supabase
    .from('jobs')
    .select('id, company_id, parent_job_id')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (jobResponse.error) {
    throw new Error(`Failed to load job: ${jobResponse.error.message}`)
  }

  const job = (jobResponse.data ?? null) as JobRow | null

  if (!job) {
    throw new Error('Job not found.')
  }

  if (job.parent_job_id) {
    return {
      rootJob: job,
      targetJobIds: [job.id],
      propagateToChildren: false,
    }
  }

  const childJobsResponse = await supabase
    .from('jobs')
    .select('id')
    .eq('company_id', companyId)
    .eq('parent_job_id', job.id)

  if (childJobsResponse.error) {
    throw new Error(`Failed to load child jobs: ${childJobsResponse.error.message}`)
  }

  const childJobIds = ((childJobsResponse.data ?? []) as Array<{ id: string }>).map((item) => item.id)

  return {
    rootJob: job,
    targetJobIds: [job.id, ...childJobIds],
    propagateToChildren: childJobIds.length > 0,
  }
}

async function isProfileInCompany(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  profileId: string
) {
  const membershipResponse = await supabase
    .from('company_members')
    .select('id')
    .eq('company_id', companyId)
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .maybeSingle()

  if (membershipResponse.error) {
    throw new Error(`Failed to verify worker membership: ${membershipResponse.error.message}`)
  }

  return Boolean(membershipResponse.data?.id)
}

export async function POST(request: NextRequest, context: RouteContext) {
  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const activeCompany = activeCompanyResult.value

  const { jobId } = await context.params
  const cleanJobId = jobId?.trim()

  if (!cleanJobId) {
    return NextResponse.json({ error: 'Missing job id.' }, { status: 400 })
  }

  const payload = (await request.json().catch(() => ({}))) as AddAssignmentPayload
  const profileId = typeof payload.profile_id === 'string' ? payload.profile_id.trim() : ''

  if (!profileId) {
    return NextResponse.json({ error: 'Missing profile id.' }, { status: 400 })
  }

  try {
    const supabase = await createSupabaseServerClient()
    const scope = await loadJobScope(supabase, activeCompany.companyId, cleanJobId)
    const workerBelongsToCompany = await isProfileInCompany(supabase, activeCompany.companyId, profileId)

    if (!workerBelongsToCompany) {
      return NextResponse.json({ error: 'Worker is not a member of this company.' }, { status: 403 })
    }

    const laborHours = toNumber(payload.labor_hours)
    const hourlyRate = toNumber(payload.hourly_rate)
    const workerType = normalizeWorkerType(payload.worker_type_snapshot)
    const billingType = workerType === 'contractor' ? normalizeBillingType(payload.assignment_billing_type) : null
    const externalAmount =
      workerType === 'contractor' && billingType !== 'hourly'
        ? toNumber(payload.external_amount)
        : null
    const note = normalizeText(payload.note)

    const existingResponse = await supabase
      .from('job_assignments')
      .select('id, job_id, profile_id')
      .in('job_id', scope.targetJobIds)
      .eq('profile_id', profileId)

    if (existingResponse.error) {
      throw new Error(`Failed to load existing assignments: ${existingResponse.error.message}`)
    }

    const existingRows = (existingResponse.data ?? []) as Array<{ id: string; job_id: string; profile_id: string | null }>
    const existingJobIds = new Set(existingRows.map((item) => item.job_id))

    if (existingRows.length > 0) {
      const updateResponse = await supabase
        .from('job_assignments')
        .update({
          labor_hours: laborHours,
          hourly_rate: hourlyRate,
          worker_type_snapshot: workerType,
          assignment_billing_type: billingType,
          external_amount: externalAmount,
          note,
        })
        .in('id', existingRows.map((item) => item.id))

      if (updateResponse.error) {
        throw new Error(`Failed to update assignments: ${updateResponse.error.message}`)
      }
    }

    const inserts = scope.targetJobIds
      .filter((targetJobId) => !existingJobIds.has(targetJobId))
      .map((targetJobId) => ({
        company_id: activeCompany.companyId,
        job_id: targetJobId,
        profile_id: profileId,
        labor_hours: laborHours,
        hourly_rate: hourlyRate,
        worker_type_snapshot: workerType,
        assignment_billing_type: billingType,
        external_amount: externalAmount,
        note,
      }))

    if (inserts.length > 0) {
      const insertResponse = await supabase.from('job_assignments').insert(inserts)

      if (insertResponse.error) {
        throw new Error(`Failed to insert assignments: ${insertResponse.error.message}`)
      }
    }

    const refreshedResponse = await supabase
      .from('job_assignments')
      .select('id, company_id, job_id, profile_id, labor_hours, hourly_rate, worker_type_snapshot, assignment_billing_type, external_amount, note, work_started_at, work_completed_at')
      .eq('job_id', cleanJobId)
      .eq('profile_id', profileId)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      assignment: refreshedResponse.data ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add assignment.' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const activeCompany = activeCompanyResult.value

  const { jobId } = await context.params
  const cleanJobId = jobId?.trim()

  if (!cleanJobId) {
    return NextResponse.json({ error: 'Missing job id.' }, { status: 400 })
  }

  const payload = (await request.json().catch(() => ({}))) as { assignments?: AssignmentInput[] }
  const inputAssignments = Array.isArray(payload.assignments) ? payload.assignments : []

  try {
    const supabase = await createSupabaseServerClient()
    const scope = await loadJobScope(supabase, activeCompany.companyId, cleanJobId)
    const profileIds = Array.from(
      new Set(
        inputAssignments
          .map((assignment) => (typeof assignment.profile_id === 'string' ? assignment.profile_id.trim() : ''))
          .filter(Boolean)
      )
    )

    for (const profileId of profileIds) {
      const workerBelongsToCompany = await isProfileInCompany(supabase, activeCompany.companyId, profileId)
      if (!workerBelongsToCompany) {
        return NextResponse.json({ error: 'Worker is not a member of this company.' }, { status: 403 })
      }
    }

    const currentResponse = await supabase
      .from('job_assignments')
      .select('id, job_id, profile_id, labor_hours, hourly_rate, worker_type_snapshot, assignment_billing_type, external_amount, note')
      .in('job_id', scope.targetJobIds)

    if (currentResponse.error) {
      throw new Error(`Failed to load assignments: ${currentResponse.error.message}`)
    }

    const currentAssignments = (currentResponse.data ?? []) as AssignmentRow[]
    const currentByJobAndProfile = new Map(
      currentAssignments
        .filter((item) => item.profile_id)
        .map((item) => [buildAssignmentKey(item.job_id, item.profile_id ?? ''), item])
    )

    for (const assignment of inputAssignments) {
      const profileId = typeof assignment.profile_id === 'string' ? assignment.profile_id.trim() : ''
      if (!profileId) continue

      const laborHours = toNumber(assignment.labor_hours)
      const hourlyRate = toNumber(assignment.hourly_rate)
      const workerType = normalizeWorkerType(assignment.worker_type_snapshot)
      const billingType = workerType === 'contractor' ? normalizeBillingType(assignment.assignment_billing_type) : null
      const externalAmount =
        workerType === 'contractor' && billingType !== 'hourly'
          ? toNumber(assignment.external_amount)
          : null
      const note = normalizeText(assignment.note)

      const updateIds: string[] = []
      const inserts: Array<{
        company_id: string
        job_id: string
        profile_id: string
        labor_hours: number
        hourly_rate: number
        worker_type_snapshot: string
        assignment_billing_type: string | null
        external_amount: number | null
        note: string | null
      }> = []

      for (const targetJobId of scope.targetJobIds) {
        const existing = currentByJobAndProfile.get(buildAssignmentKey(targetJobId, profileId))

        if (existing) {
          updateIds.push(existing.id)
        } else {
          inserts.push({
            company_id: activeCompany.companyId,
            job_id: targetJobId,
            profile_id: profileId,
            labor_hours: laborHours,
            hourly_rate: hourlyRate,
            worker_type_snapshot: workerType,
            assignment_billing_type: billingType,
            external_amount: externalAmount,
            note,
          })
        }
      }

      if (updateIds.length > 0) {
        const updateResponse = await supabase
          .from('job_assignments')
          .update({
            labor_hours: laborHours,
            hourly_rate: hourlyRate,
            worker_type_snapshot: workerType,
            assignment_billing_type: billingType,
            external_amount: externalAmount,
            note,
          })
          .in('id', updateIds)

        if (updateResponse.error) {
          throw new Error(`Failed to update assignments: ${updateResponse.error.message}`)
        }
      }

      if (inserts.length > 0) {
        const insertResponse = await supabase.from('job_assignments').insert(inserts)

        if (insertResponse.error) {
          throw new Error(`Failed to insert propagated assignments: ${insertResponse.error.message}`)
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save assignments.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const activeCompany = activeCompanyResult.value

  const { jobId } = await context.params
  const cleanJobId = jobId?.trim()

  if (!cleanJobId) {
    return NextResponse.json({ error: 'Missing job id.' }, { status: 400 })
  }

  const payload = (await request.json().catch(() => ({}))) as DeleteAssignmentPayload
  const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId.trim() : ''

  if (!assignmentId) {
    return NextResponse.json({ error: 'Missing assignment id.' }, { status: 400 })
  }

  try {
    const supabase = await createSupabaseServerClient()
    const scope = await loadJobScope(supabase, activeCompany.companyId, cleanJobId)
    const assignmentResponse = await supabase
      .from('job_assignments')
      .select('id, job_id, profile_id')
      .eq('id', assignmentId)
      .maybeSingle()

    if (assignmentResponse.error) {
      throw new Error(`Failed to load assignment: ${assignmentResponse.error.message}`)
    }

    const assignment = (assignmentResponse.data ?? null) as AssignmentRow | null

    if (!assignment?.id || !assignment.profile_id || !scope.targetJobIds.includes(assignment.job_id)) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
    }

    const deleteResponse = await supabase
      .from('job_assignments')
      .delete()
      .in('job_id', scope.targetJobIds)
      .eq('profile_id', assignment.profile_id)

    if (deleteResponse.error) {
      throw new Error(`Failed to delete assignments: ${deleteResponse.error.message}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete assignment.' },
      { status: 500 }
    )
  }
}
