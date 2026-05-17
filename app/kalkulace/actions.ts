'use server'

import { revalidatePath } from 'next/cache'

import { requireHubDalContext } from '@/lib/dal/auth'
import { requireCompanyModule } from '@/lib/module-access'

export type DeleteCalculationResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export async function deleteCalculationAction(calculationId: string): Promise<DeleteCalculationResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'quotes')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }
    const id = String(calculationId ?? '').trim()

    if (!id) {
    return { ok: false, error: 'Chybí ID kalkulace.' }
    }

    const calculationResponse = await supabase
      .from('calculations')
      .select('id, customer_id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()

    const calculation = calculationResponse.data as { id?: string | null; customer_id?: string | null } | null

    if (calculationResponse.error || !calculation?.id) {
      return { ok: false, error: 'Kalkulace nebyla nalezena v aktivni firme.' }
    }

    const deleteResponse = await supabase
      .from('calculations')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (deleteResponse.error) {
    return { ok: false, error: deleteResponse.error.message || 'Kalkulaci se nepodařilo smazat.' }
    }

    revalidatePath('/kalkulace')
    if (calculation.customer_id) {
      revalidatePath(`/customers/${calculation.customer_id}/calculations`)
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Kalkulaci se nepodařilo smazat.',
    }
  }
}
