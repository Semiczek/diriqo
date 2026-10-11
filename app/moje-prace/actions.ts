'use server'

import { revalidatePath } from 'next/cache'

import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { requireCompanyModule } from '@/lib/module-access'

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

    return { ok: false, error: 'Akci se nepodařilo dokončit.' }
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

async function getWorkerContext(operation: 'shift' | 'complete' | 'stop') {
  const access = await requireWorkerAccess()

  if (!access.ok) {
    throw new Error(access.error)
  }

  // Stopping an already running own shift remains available after expiry; it
  // settles existing work and must not leave an employee clocked in forever.
  if (operation !== 'stop') {
    const licence = operation === 'complete'
      ? await requireCompanyModule(access.value.companyId, 'jobs', 'core.jobs.update')
      : await requireCompanyModule(access.value.companyId, 'shifts', 'core.time.record')
    if (!licence.ok) throw new Error(licence.error)
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
    .eq('company_id', companyId)
    .eq('jobs.company_id', companyId)
    .eq('profile_id', profileId)
    .is('archived_at', null)
    .limit(1)

  if (assignmentResponse.error) {
    throw new Error(`Zakázku se nepodařilo ověřit: ${assignmentResponse.error.message}`)
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
    throw new Error('Zakázka není přiřazena aktuálnímu pracovníkovi.')
  }

  return assignment
}

export async function startMyJobShiftAction(input: {
  jobId: string
}): Promise<WorkerActionResult<{ shiftId: string; reused: boolean }>> {
  try {
    const { supabase, companyId, profileId } = await getWorkerContext('shift')
    const admin = createSupabaseAdminClient()
  const jobId = requiredId(input.jobId, 'Zakázka')
    const assignment = await assertAssignedJob(supabase, companyId, profileId, jobId)
    if (assignment.completed_at || assignment.work_completed_at || assignment.status === 'completed') {
      throw new Error('Dokončenou práci již nelze spustit. Obraťte se na správce.')
    }

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
    throw new Error(`Směnu se nepodařilo načíst: ${existingShiftResponse.error.message}`)
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
    throw new Error(`Směnu se nepodařilo spustit: ${insertResponse.error?.message ?? 'neznámý problém'}`)
    }

    await admin
      .from('job_assignments')
      .update({
        status: 'in_progress',
        work_started_at: nowIso,
      })
      .eq('job_id', jobId)
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .is('archived_at', null)

    revalidatePath('/moje-prace')
    revalidatePath('/mobile/my')
    revalidatePath('/mobile/my/finish')
    revalidatePath('/mobile/manager')
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
    const { companyId, profileId } = await getWorkerContext('stop')
    const admin = createSupabaseAdminClient()
  const shiftId = requiredId(input.shiftId, 'Směna')

    const shiftResponse = await admin
      .from('work_shifts')
      .select('id, job_id, ended_at')
      .eq('id', shiftId)
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .maybeSingle()

    if (shiftResponse.error) {
    throw new Error(`Směnu se nepodařilo načíst: ${shiftResponse.error.message}`)
    }

    if (!shiftResponse.data?.id) {
    throw new Error('Směna nebyla nalezena.')
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
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .is('ended_at', null)

    if (updateResponse.error) {
    throw new Error(`Směnu se nepodařilo ukončit: ${updateResponse.error.message}`)
    }

    revalidatePath('/moje-prace')
    revalidatePath('/mobile/my')
    revalidatePath('/mobile/my/finish')
    revalidatePath('/mobile/manager')

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
    const { supabase, companyId, profileId } = await getWorkerContext('complete')
    const admin = createSupabaseAdminClient()
  const jobId = requiredId(input.jobId, 'Zakázka')
    const assignment = await assertAssignedJob(supabase, companyId, profileId, jobId)

    if (assignment.completed_at || assignment.work_completed_at || assignment.status === 'completed') {
      return { ok: true, data: { jobId, reused: true } }
    }

    const openShift = await admin.from('work_shifts').select('id')
      .eq('company_id', companyId).eq('profile_id', profileId).eq('job_id', jobId).is('ended_at', null).limit(1)
    if (openShift.error) throw new Error('Směnu se nepodařilo ověřit. Zkuste to znovu.')
    if (openShift.data?.length) throw new Error('Nejdříve ukončete směnu tlačítkem Stop.')

    const nowIso = new Date().toISOString()
    const assignmentUpdateResponse = await admin
      .from('job_assignments')
      .update({
        status: 'completed',
        completed_at: nowIso,
        work_completed_at: nowIso,
      })
      .eq('id', assignment.id)
      .eq('company_id', companyId)
      .eq('profile_id', profileId)
      .is('archived_at', null)

    if (assignmentUpdateResponse.error) {
    throw new Error(`Zakázku se nepodařilo označit jako hotovou: ${assignmentUpdateResponse.error.message}`)
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
    revalidatePath('/mobile/my')
    revalidatePath('/mobile/my/finish')
    revalidatePath('/mobile/manager')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true, data: { jobId, reused: false } }
  } catch (error) {
    return actionError(error)
  }
}
