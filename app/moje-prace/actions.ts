'use server'

import { revalidatePath } from 'next/cache'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { requireCompanyModule } from '@/lib/module-access'

export type WorkerActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const operationErrors: Record<string, string> = {
  WORK_FORBIDDEN: 'Oprávnění se změnilo. Obnovte přihlášení a výběr firmy.',
  WORK_JOB_NOT_ASSIGNED: 'Zakázka není přiřazena aktuálnímu pracovníkovi.',
  WORK_SHIFT_NOT_FOUND: 'Směna nebyla nalezena.',
  WORK_MODULE_REQUIRED: 'Pro tuto operaci potřebujete aktivní modul.',
  WORK_MODULE_DISABLED: 'Tento modul je pro aktivní firmu vypnutý.',
  WORK_ALREADY_COMPLETED: 'Dokončenou práci již nelze spustit. Obraťte se na správce.',
  WORK_SHIFT_STILL_RUNNING: 'Nejdříve ukončete směnu tlačítkem Stop.',
  WORK_ANOTHER_SHIFT_RUNNING: 'Už máte spuštěnou jinou směnu. Nejdříve ji ukončete.',
  WORK_TIMEZONE_INVALID: 'Správce musí opravit časové pásmo firmy.',
}
const uncertainResult = 'Výsledek se nepodařilo ověřit. Obnovte přehled práce před další akcí.'
type WorkResult = { shift_id?: string; job_id: string | null; reused: boolean }

async function mutateWork(operation: 'start' | 'stop' | 'complete', id: string): Promise<WorkResult> {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('Neplatný identifikátor práce.')
  id = id.toLowerCase()
  const access = await requireWorkerAccess()
  if (!access.ok) throw new Error(access.error)
  // Settlement remains available after expiry, but never after membership revocation.
  if (operation !== 'stop') {
    const licence = operation === 'complete'
      ? await requireCompanyModule(access.value.companyId, 'jobs', 'core.jobs.update')
      : await requireCompanyModule(access.value.companyId, 'shifts', 'core.time.record')
    if (!licence.ok) throw new Error(licence.error)
  }
  const supabase = await createSupabaseServerClient()
  // The authenticated transaction derives the worker and rechecks current access.
  const { data, error } = await supabase.rpc('mutate_my_job_work', {
    target_company_id: access.value.companyId,
    operation,
    target_job_id: operation === 'stop' ? null : id,
    target_shift_id: operation === 'stop' ? id : null,
  }).then((result) => result, () => { throw new Error(uncertainResult) })
  if (error) {
    if (error.code === '23505') throw new Error(operationErrors.WORK_ANOTHER_SHIFT_RUNNING)
    throw new Error(operationErrors[error.message] ?? uncertainResult)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.reused !== 'boolean'
    || (data.job_id !== null && (typeof data.job_id !== 'string' || !uuid.test(data.job_id)))
    || (operation !== 'stop' && data.job_id !== id)
    || (operation !== 'complete' && (typeof data.shift_id !== 'string' || !uuid.test(data.shift_id)))
    || (operation === 'stop' && data.shift_id !== id)) throw new Error(uncertainResult)
  for (const path of ['/moje-prace', '/mobile/my', '/mobile/my/finish', '/mobile/manager']) revalidatePath(path)
  if (data.job_id) revalidatePath(`/jobs/${data.job_id}`)
  return data as WorkResult
}

function actionError(error: unknown): WorkerActionResult<never> {
  return { ok: false, error: error instanceof Error && error.message.trim() ? error.message : uncertainResult }
}

export async function startMyJobShiftAction(input: { jobId: string }): Promise<WorkerActionResult<{ shiftId: string; reused: boolean }>> {
  try {
    const result = await mutateWork('start', input.jobId)
    return { ok: true, data: { shiftId: result.shift_id!, reused: result.reused } }
  } catch (error) { return actionError(error) }
}

export async function stopMyJobShiftAction(input: { shiftId: string }): Promise<WorkerActionResult<{ shiftId: string; reused: boolean }>> {
  try {
    const result = await mutateWork('stop', input.shiftId)
    return { ok: true, data: { shiftId: result.shift_id!, reused: result.reused } }
  } catch (error) { return actionError(error) }
}

export async function completeMyJobAction(input: { jobId: string }): Promise<WorkerActionResult<{ jobId: string; reused: boolean }>> {
  try {
    const result = await mutateWork('complete', input.jobId)
    return { ok: true, data: { jobId: result.job_id!, reused: result.reused } }
  } catch (error) { return actionError(error) }
}
