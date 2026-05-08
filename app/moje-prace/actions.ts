'use server'

import { revalidatePath } from 'next/cache'

import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type WorkerActionResult<T = void> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
    }

function actionError(error: unknown): WorkerActionResult<never> {
  if (error instanceof Error && error.message.trim()) {
    return { ok: false, error: error.message }
  }

  return { ok: false, error: 'Akci se nepodarilo dokoncit.' }
}

function requiredId(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} je povinne.`)
  }

  return value.trim()
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10)
}

async function getWorkerContext() {
  const access = await requireWorkerAccess()

  if (!access.ok) {
    throw new Error(access.error)
  }

  const supabase = await createSupabaseServerClient()

  return {
    supabase,
    companyId: access.value.companyId,
    profileId: access.value.profileId,
  }
}

async function assertAssignedJob(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  profileId: string,
  jobId: string,
) {
  const assignmentResponse = await supabase
    .from('job_assignments')
    .select(
      `
        id,
        status,
        completed_at,
        work_completed_at,
        jobs!inner (
          id,
          company_id
        )
      `,
    )
    .eq('job_id', jobId)
    .eq('profile_id', profileId)
    .is('archived_at', null)
    .limit(1)

  if (assignmentResponse.error) {
    throw new Error(`Zakazku se nepodarilo overit: ${assignmentResponse.error.message}`)
  }

  const assignment = assignmentResponse.data?.[0] as
    | {
        id: string
        status: string | null
        completed_at: string | null
        work_completed_at: string | null
        jobs?: { id: string; company_id: string | null } | { id: string; company_id: string | null }[] | null
      }
    | undefined
  const job = Array.isArray(assignment?.jobs) ? assignment?.jobs[0] : assignment?.jobs

  if (!assignment?.id || job?.company_id !== companyId) {
    throw new Error('Zakazka neni prirazena aktualnimu pracovnikovi.')
  }

  return assignment
}

export async function startMyJobShiftAction(input: {
  jobId: string
}): Promise<WorkerActionResult<{ shiftId: string; reused: boolean }>> {
  try {
    const { supabase, companyId, profileId } = await getWorkerContext()
    const admin = createSupabaseAdminClient()
    const jobId = requiredId(input.jobId, 'Zakazka')
    await assertAssignedJob(supabase, companyId, profileId, jobId)

    const existingShiftResponse = await admin
      .from('work_shifts')
      .select('id')
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .eq('job_id', jobId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)

    if (existingShiftResponse.error) {
      throw new Error(`Smenu se nepodarilo nacist: ${existingShiftResponse.error.message}`)
    }

    const existingShiftId = existingShiftResponse.data?.[0]?.id

    if (existingShiftId) {
      return { ok: true, data: { shiftId: existingShiftId, reused: true } }
    }

    const nowIso = new Date().toISOString()
    const insertResponse = await admin
      .from('work_shifts')
      .insert({
        company_id: companyId,
        profile_id: profileId,
        job_id: jobId,
        shift_date: getTodayDate(),
        started_at: nowIso,
        status: 'running',
        note: 'Start z worker flow',
      })
      .select('id')
      .single()

    if (insertResponse.error || !insertResponse.data?.id) {
      throw new Error(`Smenu se nepodarilo spustit: ${insertResponse.error?.message ?? 'neznamy problem'}`)
    }

    await admin
      .from('job_assignments')
      .update({
        status: 'in_progress',
        work_started_at: nowIso,
      })
      .eq('job_id', jobId)
      .eq('profile_id', profileId)
      .is('archived_at', null)

    revalidatePath('/moje-prace')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true, data: { shiftId: insertResponse.data.id, reused: false } }
  } catch (error) {
    return actionError(error)
  }
}

export async function stopMyJobShiftAction(input: {
  shiftId: string
}): Promise<WorkerActionResult<{ shiftId: string; reused: boolean }>> {
  try {
    const { companyId, profileId } = await getWorkerContext()
    const admin = createSupabaseAdminClient()
    const shiftId = requiredId(input.shiftId, 'Smena')

    const shiftResponse = await admin
      .from('work_shifts')
      .select('id, job_id, ended_at')
      .eq('id', shiftId)
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .maybeSingle()

    if (shiftResponse.error) {
      throw new Error(`Smenu se nepodarilo nacist: ${shiftResponse.error.message}`)
    }

    if (!shiftResponse.data?.id) {
      throw new Error('Smena nebyla nalezena.')
    }

    if (shiftResponse.data.ended_at) {
      return { ok: true, data: { shiftId, reused: true } }
    }

    const updateResponse = await admin
      .from('work_shifts')
      .update({
        ended_at: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', shiftId)
      .is('ended_at', null)

    if (updateResponse.error) {
      throw new Error(`Smenu se nepodarilo ukoncit: ${updateResponse.error.message}`)
    }

    revalidatePath('/moje-prace')

    if (shiftResponse.data.job_id) {
      revalidatePath(`/jobs/${shiftResponse.data.job_id}`)
    }

    return { ok: true, data: { shiftId, reused: false } }
  } catch (error) {
    return actionError(error)
  }
}

export async function completeMyJobAction(input: {
  jobId: string
}): Promise<WorkerActionResult<{ jobId: string; reused: boolean }>> {
  try {
    const { supabase, companyId, profileId } = await getWorkerContext()
    const admin = createSupabaseAdminClient()
    const jobId = requiredId(input.jobId, 'Zakazka')
    const assignment = await assertAssignedJob(supabase, companyId, profileId, jobId)

    if (assignment.completed_at || assignment.work_completed_at || assignment.status === 'completed') {
      return { ok: true, data: { jobId, reused: true } }
    }

    const nowIso = new Date().toISOString()
    const assignmentUpdateResponse = await admin
      .from('job_assignments')
      .update({
        status: 'completed',
        completed_at: nowIso,
        work_completed_at: nowIso,
      })
      .eq('id', assignment.id)
      .is('archived_at', null)

    if (assignmentUpdateResponse.error) {
      throw new Error(`Zakazku se nepodarilo oznacit jako hotovou: ${assignmentUpdateResponse.error.message}`)
    }

    await admin
      .from('jobs')
      .update({
        status: 'waiting_check',
        work_state: 'partially_done',
      })
      .eq('id', jobId)
      .eq('company_id', companyId)
      .in('status', ['planned', 'scheduled', 'in_progress', 'waiting_check'])

    revalidatePath('/moje-prace')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true, data: { jobId, reused: false } }
  } catch (error) {
    return actionError(error)
  }
}
