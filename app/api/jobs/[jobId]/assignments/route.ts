import { NextRequest, NextResponse } from 'next/server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { approvedLaborSourceCode, isApprovedLaborSourceError, laborSourceReviewHref } from '@/lib/labor-source-navigation'

type RouteContext = {
  params: Promise<{
    jobId: string
  }>
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

function protectedAssignmentResponse(
  company: { companyId: string; profileId: string },
  workerId: string,
  affected: Array<{ id: string; job_id: string }>,
) {
  // A propagated statement can fail on any child. Never claim the root is the
  // protected source when Postgres only identifies the domain error.
  const reviewHref = affected.length === 1
    ? laborSourceReviewHref({ companyId: company.companyId, actorProfileId: company.profileId,
      jobId: affected[0].job_id, profileId: workerId, source: { kind: 'assignment', id: affected[0].id } })
    : `/labor?${new URLSearchParams({ company: company.companyId, actor: company.profileId, worker: workerId })}`
  return NextResponse.json({
    error: 'Schválenou práci nelze přepsat ani odstranit. Otevřete výkaz a vytvořte opravu ke schválení.',
    code: approvedLaborSourceCode, reviewHref,
  }, { status: 409 })
}

class AssignmentValidationError extends Error {}

function optionalNonNegativeNumber(value: unknown, field: string, required: boolean): number | null {
  if (value === null || value === undefined) {
    if (required) throw new AssignmentValidationError(`Missing ${field}.`)
    return null
  }
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw new AssignmentValidationError(`Invalid ${field}.`)
  }
  const parsed = Number(value)
  // The three fields are numeric(12,2); reject rounding to zero or overflow.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999.99) throw new AssignmentValidationError(`Invalid ${field}.`)
  return parsed
}

function normalizeAssignmentInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssignmentValidationError('Invalid assignment.')
  const row = value as Record<string, unknown>
  const profileId = typeof row.profile_id === 'string' ? row.profile_id.trim() : ''
  if (!profileId) throw new AssignmentValidationError('Missing profile id.')
  const workerType = row.worker_type_snapshot ?? 'employee'
  if (workerType !== 'employee' && workerType !== 'contractor') throw new AssignmentValidationError('Invalid worker type.')
  const billingType = workerType === 'contractor' ? row.assignment_billing_type : null
  if (workerType === 'contractor' && billingType !== 'hourly' && billingType !== 'fixed' && billingType !== 'invoice') {
    throw new AssignmentValidationError('Invalid contractor billing type.')
  }
  const hourly = workerType === 'employee' || billingType === 'hourly'
  const laborHours = optionalNonNegativeNumber(row.labor_hours, 'labor_hours', hourly)
  const hourlyRate = optionalNonNegativeNumber(row.hourly_rate, 'hourly_rate', hourly)
  const amount = optionalNonNegativeNumber(row.external_amount, 'external_amount', !hourly)
  // Legacy hours/rate columns are NOT NULL DEFAULT 0. For fixed/invoice
  // work, omit absent optional values rather than resetting an existing row.
  const hoursAndRate: { labor_hours?: number; hourly_rate?: number } = {
    ...(laborHours === null ? {} : { labor_hours: laborHours }),
    ...(hourlyRate === null ? {} : { hourly_rate: hourlyRate }),
  }
  return {
    profileId, hoursAndRate, workerType,
    billingType: billingType as 'hourly' | 'fixed' | 'invoice' | null,
    externalAmount: hourly ? null : amount,
    note: typeof row.note === 'string' ? row.note.trim() || null : null,
  }
}

function invalidAssignmentResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof AssignmentValidationError ? error.message : 'Invalid assignment payload.' }, { status: 400 })
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

  let assignment: ReturnType<typeof normalizeAssignmentInput>
  try {
    assignment = normalizeAssignmentInput(await request.json())
  } catch (error) {
    return invalidAssignmentResponse(error)
  }
  const { profileId, hoursAndRate, workerType, billingType, externalAmount, note } = assignment

  try {
    const supabase = await createSupabaseServerClient()
    const scope = await loadJobScope(supabase, activeCompany.companyId, cleanJobId)
    const workerBelongsToCompany = await isProfileInCompany(supabase, activeCompany.companyId, profileId)

    if (!workerBelongsToCompany) {
      return NextResponse.json({ error: 'Worker is not a member of this company.' }, { status: 403 })
    }

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
          ...hoursAndRate,
          worker_type_snapshot: workerType,
          assignment_billing_type: billingType,
          external_amount: externalAmount,
          note,
        })
        .in('id', existingRows.map((item) => item.id))

      if (isApprovedLaborSourceError(updateResponse.error)) {
        return protectedAssignmentResponse(activeCompany, profileId, existingRows)
      }
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
        ...hoursAndRate,
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

  let inputAssignments: Array<ReturnType<typeof normalizeAssignmentInput>>
  try {
    const payload: unknown = await request.json()
    if (!payload || typeof payload !== 'object' || !('assignments' in payload)
      || !Array.isArray(payload.assignments) || payload.assignments.length === 0) {
      throw new AssignmentValidationError('Missing assignments.')
    }
    // Validate every row before performing any writes in this legacy batch.
    inputAssignments = payload.assignments.map(normalizeAssignmentInput)
  } catch (error) {
    return invalidAssignmentResponse(error)
  }

  try {
    const supabase = await createSupabaseServerClient()
    const scope = await loadJobScope(supabase, activeCompany.companyId, cleanJobId)
    const profileIds = Array.from(new Set(inputAssignments.map(assignment => assignment.profileId)))

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
      const { profileId, hoursAndRate, workerType, billingType, externalAmount, note } = assignment

      const updateIds: string[] = []
      const inserts: Array<{
        company_id: string
        job_id: string
        profile_id: string
        labor_hours?: number
        hourly_rate?: number
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
            ...hoursAndRate,
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
            ...hoursAndRate,
            worker_type_snapshot: workerType,
            assignment_billing_type: billingType,
            external_amount: externalAmount,
            note,
          })
          .in('id', updateIds)

        if (isApprovedLaborSourceError(updateResponse.error)) {
          return protectedAssignmentResponse(activeCompany, profileId, currentAssignments.filter(item => updateIds.includes(item.id)))
        }
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

    if (isApprovedLaborSourceError(deleteResponse.error)) {
      return protectedAssignmentResponse(activeCompany, assignment.profile_id, scope.propagateToChildren ? [] : [assignment])
    }
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
