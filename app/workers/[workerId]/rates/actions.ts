'use server'

import { revalidatePath } from 'next/cache'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { scheduleLaborRate } from '@/lib/dal/labor-history'
import { LaborHistoryError, parseLaborRateScheduleInput, type LaborRateMutationReceipt } from '@/lib/labor-history'

export type ScheduleWorkerRateResult =
  | { ok: true; data: LaborRateMutationReceipt }
  | { ok: false; error: string; code: string; uncertain: boolean }

export async function scheduleWorkerRateAction(raw: unknown): Promise<ScheduleWorkerRateResult> {
  let mutationStarted = false
  try {
    const input = parseLaborRateScheduleInput(raw)
    const ctx = await requireCompanyRoleDalContext('super_admin', 'company_admin')
    mutationStarted = true
    const data = await scheduleLaborRate(ctx, input)
    // A failed cache refresh cannot turn a confirmed write into an unknown write.
    try {
      revalidatePath(`/workers/${input.profileId}/rates`)
      revalidatePath(`/workers/${input.profileId}`)
    } catch { /* The receipt lets the caller reopen the confirmed schedule. */ }
    return { ok: true, data }
  } catch (error) {
    if (error instanceof LaborHistoryError) {
      return { ok: false, error: error.message, code: error.code, uncertain: error.uncertain }
    }
    return {
      ok: false,
      error: mutationStarted ? 'Výsledek uložení není potvrzený. Ověřte stejný požadavek.' : 'Nastavení sazeb není pro tento účet dostupné.',
      code: mutationStarted ? 'LABOR_UNKNOWN_OUTCOME' : 'LABOR_ACCESS_DENIED',
      uncertain: mutationStarted,
    }
  }
}
