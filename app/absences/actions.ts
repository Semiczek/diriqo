'use server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type AbsenceStatusActionResult =
  | {
      ok: true
      data: {
        reviewedAt: string
      }
    }
  | {
      ok: false
      error: string
    }

export async function updateAbsenceStatusAction(input: {
  absenceId: string
  status: 'approved' | 'rejected'
}): Promise<AbsenceStatusActionResult> {
  const access = await requireCompanyRole('company_admin', 'super_admin')

  if (!access.ok) {
    return { ok: false, error: access.error }
  }

  const absenceId = input.absenceId?.trim()

  if (!absenceId || (input.status !== 'approved' && input.status !== 'rejected')) {
    return { ok: false, error: 'Neplatna zadost o absenci.' }
  }

  const supabase = await createSupabaseServerClient()
  const nowIso = new Date().toISOString()
  const updateResponse = await supabase
    .from('absence_requests')
    .update({
      status: input.status,
      reviewed_at: nowIso,
      reviewed_by: access.value.profileId,
    })
    .eq('id', absenceId)
    .eq('company_id', access.value.companyId)
    .eq('status', 'pending')
    .select('id')

  if (updateResponse.error) {
    return { ok: false, error: updateResponse.error.message }
  }

  if ((updateResponse.data ?? []).length === 0) {
    return { ok: false, error: 'Zadost uz byla zpracovana nebo neni dostupna.' }
  }

  return { ok: true, data: { reviewedAt: nowIso } }
}
