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
      return { ok: false, error: 'Chybi ID pracovnika.' }
    }

    if (!isValidPayrollMonth(payrollMonth)) {
      return { ok: false, error: 'Vyberte platny mzdovy mesic.' }
    }

    if (!isValidPayrollItemType(itemType)) {
      return { ok: false, error: 'Vyberte platny typ polozky.' }
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: 'Castka musi byt nezaporne cislo.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
      return { ok: false, error: 'Pracovnik nepatri do aktivni firmy.' }
    }

    const insertResponse = await supabase.from('payroll_items').insert({
      profile_id: workerId,
      payroll_month: payrollMonth,
      item_type: itemType,
      amount,
      note: cleanOptionalString(input.note),
    })

    if (insertResponse.error) {
      return { ok: false, error: insertResponse.error.message || 'Polozku se nepodarilo ulozit.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Polozku se nepodarilo ulozit.',
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
      return { ok: false, error: 'Chybi ID polozky.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
      return { ok: false, error: 'Pracovnik nepatri do aktivni firmy.' }
    }

    const deleteResponse = await supabase
      .from('payroll_items')
      .delete()
      .eq('id', payrollItemId)
      .eq('profile_id', workerId)

    if (deleteResponse.error) {
      return { ok: false, error: deleteResponse.error.message || 'Polozku se nepodarilo smazat.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Polozku se nepodarilo smazat.',
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
      return { ok: false, error: 'Chybi ID pracovnika.' }
    }

    if (!fullName) {
      return { ok: false, error: 'Zadejte jmeno pracovnika.' }
    }

    if (parsedRate != null && !Number.isFinite(parsedRate)) {
      return { ok: false, error: 'Sazba musi byt platne cislo.' }
    }

    const workerAllowed = await verifyWorkerInCompany({ supabase, companyId, workerId })
    if (!workerAllowed) {
      return { ok: false, error: 'Pracovnik nepatri do aktivni firmy.' }
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
      return { ok: false, error: updateResponse.error.message || 'Pracovnika se nepodarilo ulozit.' }
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${workerId}`)
    revalidatePath(`/workers/${workerId}/finance/edit`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Pracovnika se nepodarilo ulozit.',
    }
  }
}
