import { NextRequest, NextResponse } from 'next/server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RouteContext = {
  params: Promise<{
    assignmentId: string
  }>
}

type ActionPayload = {
  action?: 'reset_hours' | 'archive'
  reason?: string | null
}

type AssignmentCheckRow = {
  id: string
  job_id: string | null
  profile_id: string | null
  jobs?: { company_id: string | null } | { company_id: string | null }[] | null
}

function asSingleRelation<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function normalizeReason(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized ? normalized.slice(0, 500) : null
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const activeCompany = activeCompanyResult.value

  const { assignmentId } = await context.params
  const cleanAssignmentId = assignmentId?.trim()

  if (!cleanAssignmentId) {
    return NextResponse.json({ error: 'Missing assignment id.' }, { status: 400 })
  }

  const payload = (await request.json().catch(() => ({}))) as ActionPayload
  const action = payload.action

  if (action !== 'reset_hours' && action !== 'archive') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()

  const assignmentResponse = await supabase
    .from('job_assignments')
    .select(
      `
        id,
        job_id,
        profile_id,
        jobs!inner (
          company_id
        )
      `
    )
    .eq('id', cleanAssignmentId)
    .maybeSingle()

  if (assignmentResponse.error) {
    return NextResponse.json(
      { error: `Failed to load assignment: ${assignmentResponse.error.message}` },
      { status: 500 }
    )
  }

  const assignment = assignmentResponse.data as AssignmentCheckRow | null
  const job = asSingleRelation(assignment?.jobs)

  if (!assignment?.id || job?.company_id !== activeCompany.companyId) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()
  const reason = normalizeReason(payload.reason)

  const updatePayload =
    action === 'reset_hours'
      ? {
          labor_hours: null,
          work_started_at: null,
          work_completed_at: null,
          reset_at: nowIso,
          reset_by: activeCompany.profileId,
          reset_reason: reason,
        }
      : {
          archived_at: nowIso,
          archived_by: activeCompany.profileId,
          archive_reason: reason,
          labor_hours: null,
          work_started_at: null,
          work_completed_at: null,
        }

  const updateResponse = await supabase
    .from('job_assignments')
    .update(updatePayload)
    .eq('id', assignment.id)

  if (updateResponse.error) {
    return NextResponse.json(
      { error: `Failed to update assignment: ${updateResponse.error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')

  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const activeCompany = activeCompanyResult.value

  const { assignmentId } = await context.params
  const cleanAssignmentId = assignmentId?.trim()

  if (!cleanAssignmentId) {
    return NextResponse.json({ error: 'Missing assignment id.' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()

  const assignmentResponse = await supabase
    .from('job_assignments')
    .select(
      `
        id,
        job_id,
        profile_id,
        jobs!inner (
          company_id
        )
      `
    )
    .eq('id', cleanAssignmentId)
    .maybeSingle()

  if (assignmentResponse.error) {
    return NextResponse.json(
      { error: `Failed to load assignment: ${assignmentResponse.error.message}` },
      { status: 500 }
    )
  }

  const assignment = assignmentResponse.data as AssignmentCheckRow | null
  const job = asSingleRelation(assignment?.jobs)

  if (!assignment?.id || job?.company_id !== activeCompany.companyId) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const deleteResponse = await supabase
    .from('job_assignments')
    .delete()
    .eq('id', assignment.id)

  if (deleteResponse.error) {
    return NextResponse.json(
      { error: `Failed to delete assignment: ${deleteResponse.error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
