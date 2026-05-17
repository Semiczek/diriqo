'use server'

import { revalidatePath } from 'next/cache'

import { requireHubDalContext } from '@/lib/dal/auth'
import { requireCompanyModule } from '@/lib/module-access'

type PayrollItemType = 'bonus' | 'meal' | 'deduction'

export type WorkerFinanceMutationResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function cleanOptionalString(value: unknown) {
  const cleaned = cleanString(value)
  return cleaned || null
}

function isValidPayrollItemType(value: string): value is PayrollItemType {
  return value === 'bonus' || value === 'meal' || value === 'deduction'
}

function isValidPayrollMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value)
}

async function verifyWorkerInCompany(input: {
  supabase: Awaited<ReturnType<typeof requireHubDalContext>>['supabase']
  companyId: string
  workerId: string
}) {
  const memberResponse = await input.supabase
    .from('company_members')
    .select('id')
    .eq('profile_id', input.workerId)
    .eq('company_id', input.companyId)
    .eq('is_active', true)
    .limit(1)

  if (memberResponse.error || (memberResponse.data ?? []).length === 0) {
    return false
  }

  return true
}

export async function createPayrollItemAction(input: {
  workerId?: string | null
  payrollMonth?: string | null
  itemType?: string | null
  amount?: string | number | null
  note?: string | null
}): Promise<WorkerFinanceMutationResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'payroll')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const workerId = cleanString(input.workerId)
    const payrollMonth = cleanString(input.payrollMonth)
    const itemType = cleanString(input.itemType)
    const amount = Number(input.amount)

    if (!workerId) {
    return { ok: false, error: 'Chybí ID pracovníka.' }
    }

    if (!isValidPayrollMonth(payrollMonth)) {
      return { ok: false, error: 'Vyberte platny mzdovy mesic.' }
    }

    if (!isValidPayrollItemType(itemType)) {
    return { ok: false, error: 'Vyberte platný typ položky.' }
    }

    if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'Částka musí být nezáporné číslo.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
    return { ok: false, error: 'Pracovník nepatří do aktivní firmy.' }
    }

    const insertResponse = await supabase.from('payroll_items').insert({
      profile_id: workerId,
      payroll_month: payrollMonth,
      item_type: itemType,
      amount,
      note: cleanOptionalString(input.note),
    })

    if (insertResponse.error) {
    return { ok: false, error: insertResponse.error.message || 'Položku se nepodařilo uložit.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Položku se nepodařilo uložit.',
    }
  }
}

export async function deletePayrollItemAction(input: {
  workerId?: string | null
  payrollItemId?: string | null
}): Promise<WorkerFinanceMutationResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'payroll')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const workerId = cleanString(input.workerId)
    const payrollItemId = cleanString(input.payrollItemId)

    if (!workerId || !payrollItemId) {
    return { ok: false, error: 'Chybí ID položky.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
    return { ok: false, error: 'Pracovník nepatří do aktivní firmy.' }
    }

    const deleteResponse = await supabase
      .from('payroll_items')
      .delete()
      .eq('id', payrollItemId)
      .eq('profile_id', workerId)

    if (deleteResponse.error) {
    return { ok: false, error: deleteResponse.error.message || 'Položku se nepodařilo smazat.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Položku se nepodařilo smazat.',
    }
  }
}

export async function updateWorkerProfileAction(input: {
  workerId?: string | null
  fullName?: string | null
  email?: string | null
  defaultHourlyRate?: string | number | null
}): Promise<WorkerFinanceMutationResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'workers')
    const workerId = cleanString(input.workerId)
    const fullName = cleanString(input.fullName)
    const email = cleanOptionalString(input.email)
    const parsedRate =
      input.defaultHourlyRate === null || input.defaultHourlyRate === undefined || input.defaultHourlyRate === ''
        ? null
        : Number(input.defaultHourlyRate)

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    if (!workerId) {
    return { ok: false, error: 'Chybí ID pracovníka.' }
    }

    if (!fullName) {
    return { ok: false, error: 'Zadejte jméno pracovníka.' }
    }

    if (parsedRate != null && !Number.isFinite(parsedRate)) {
    return { ok: false, error: 'Sazba musí být platné číslo.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
    return { ok: false, error: 'Pracovník nepatří do aktivní firmy.' }
    }

    const updateResponse = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        email,
        default_hourly_rate: parsedRate,
      })
      .eq('id', workerId)

    if (updateResponse.error) {
    return { ok: false, error: updateResponse.error.message || 'Pracovníka se nepodařilo uložit.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Pracovníka se nepodařilo uložit.',
    }
  }
}
