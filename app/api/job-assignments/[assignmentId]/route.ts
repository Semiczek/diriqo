import { NextRequest, NextResponse } from 'next/server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { approvedLaborSourceCode, isApprovedLaborSourceError, laborSourceReviewHref } from '@/lib/labor-source-navigation'

type RouteContext = {
  params: Promise<{
    assignmentId: string
  }>
}

type ActionPayload = {
  companyId?: string
  actorProfileId?: string
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

  const raw: unknown = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const payload = raw as ActionPayload
  const action = payload.action

  if (action !== 'reset_hours' && action !== 'archive') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  }

  if (payload.companyId !== activeCompany.companyId || payload.actorProfileId !== activeCompany.profileId) {
    return NextResponse.json({ error: 'Firma nebo přihlášený účet se změnil. Otevřete záznam znovu.' }, { status: 403 })
  }
  if (payload.reason != null && typeof payload.reason !== 'string') return NextResponse.json({ error: 'Invalid reason.' }, { status: 400 })

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
    .eq('jobs.company_id', activeCompany.companyId)
    .maybeSingle()

  if (assignmentResponse.error) {
    return NextResponse.json(
      { error: 'Failed to load assignment.' },
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
          labor_hours: 0,
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
        }

  const updateResponse = await supabase
    .from('job_assignments')
    .update(updatePayload)
    .eq('id', assignment.id)
    .eq('job_id', assignment.job_id)
    .select('id')
    .maybeSingle()

  if (updateResponse.error) {
    if (isApprovedLaborSourceError(updateResponse.error) && assignment.job_id && assignment.profile_id) {
      return NextResponse.json({
        error: 'Schválenou práci nelze přepsat ani odstranit. Otevřete výkaz a vytvořte opravu ke schválení.',
        code: approvedLaborSourceCode,
        reviewHref: laborSourceReviewHref({ companyId: activeCompany.companyId, actorProfileId: activeCompany.profileId,
          jobId: assignment.job_id, profileId: assignment.profile_id, source: { kind: 'assignment', id: assignment.id } }),
      }, { status: 409 })
    }
    return NextResponse.json(
      { error: 'Failed to update assignment.' },
      { status: 500 }
    )
  }

  if (!updateResponse.data) return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })

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
    .eq('jobs.company_id', activeCompany.companyId)
    .maybeSingle()

  if (assignmentResponse.error) {
    return NextResponse.json(
      { error: 'Failed to load assignment.' },
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
    .eq('job_id', assignment.job_id)
    .select('id')
    .maybeSingle()

  if (deleteResponse.error) {
    if (isApprovedLaborSourceError(deleteResponse.error) && assignment.job_id && assignment.profile_id) {
      return NextResponse.json({
        error: 'Schválenou práci nelze přepsat ani odstranit. Otevřete výkaz a vytvořte opravu ke schválení.',
        code: approvedLaborSourceCode,
        reviewHref: laborSourceReviewHref({ companyId: activeCompany.companyId, actorProfileId: activeCompany.profileId,
          jobId: assignment.job_id, profileId: assignment.profile_id, source: { kind: 'assignment', id: assignment.id } }),
      }, { status: 409 })
    }
    return NextResponse.json(
      { error: 'Failed to delete assignment.' },
      { status: 500 }
    )
  }

  if (!deleteResponse.data) return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
