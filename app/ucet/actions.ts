'use server'

import { revalidatePath } from 'next/cache'

import { requireCompanyRoleDalContext } from '@/lib/dal/auth'

export type AccountPayrollSettingsResult =
  | {
      ok: true
      settings: {
        company_id: string
        payroll_type: string | null
        payroll_day_of_month: number | null
        payroll_weekday: number | null
        payroll_anchor_date: string | null
        allow_advances: boolean | null
        advance_limit_amount: number | null
        advance_frequency: string | null
      }
    }
  | {
      ok: false
      error: string
    }

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function parseNullableNumber(value: unknown) {
  const cleaned = cleanString(value)
  if (!cleaned) return null
  const parsed = Number(cleaned.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePayrollType(value: unknown) {
  const cleaned = cleanString(value)
  if (cleaned === 'shift' || cleaned === 'weekly' || cleaned === 'biweekly' || cleaned === 'monthly') {
    return cleaned
  }

  return 'monthly'
}

function normalizeAdvanceFrequency(value: unknown) {
  const cleaned = cleanString(value)
  if (cleaned === 'anytime' || cleaned === 'weekly' || cleaned === 'monthly') return cleaned
  return 'anytime'
}

export async function updateAccountPayrollSettingsAction(input: {
  companyId?: string | null
  payrollType?: string | null
  payrollDayOfMonth?: string | number | null
  payrollWeekday?: string | number | null
  payrollAnchorDate?: string | null
  allowAdvances?: boolean
  advanceLimitAmount?: string | number | null
  advanceFrequency?: string | null
}): Promise<AccountPayrollSettingsResult> {
  try {
    const { supabase, companyId } = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const requestedCompanyId = cleanString(input.companyId)
    const payrollType = normalizePayrollType(input.payrollType)
    const dayOfMonth = parseNullableNumber(input.payrollDayOfMonth)
    const weekday = parseNullableNumber(input.payrollWeekday)
    const advanceLimit = parseNullableNumber(input.advanceLimitAmount)

    if (requestedCompanyId && requestedCompanyId !== companyId) {
      return { ok: false, error: 'Nastaveni lze ulozit jen pro aktivni firmu.' }
    }

    if (
      (dayOfMonth != null && (dayOfMonth < 1 || dayOfMonth > 31)) ||
      (weekday != null && (weekday < 1 || weekday > 7)) ||
      (advanceLimit != null && advanceLimit < 0)
    ) {
      return { ok: false, error: 'Zkontrolujte den vyplaty a limit zaloh.' }
    }

    const payload = {
      company_id: companyId,
      payroll_type: payrollType,
      payroll_day_of_month: payrollType === 'monthly' ? Math.trunc(dayOfMonth ?? 0) || null : null,
      payroll_weekday:
        payrollType === 'weekly' || payrollType === 'biweekly'
          ? Math.trunc(weekday ?? 0) || null
          : null,
      payroll_anchor_date:
        payrollType === 'biweekly' && cleanString(input.payrollAnchorDate)
          ? cleanString(input.payrollAnchorDate)
          : null,
      allow_advances: Boolean(input.allowAdvances),
      advance_limit_amount: advanceLimit,
      advance_frequency: normalizeAdvanceFrequency(input.advanceFrequency),
      updated_at: new Date().toISOString(),
    }

    const response = await supabase
      .from('company_payroll_settings')
      .upsert(payload, { onConflict: 'company_id' })
      .select('company_id, payroll_type, payroll_day_of_month, payroll_weekday, payroll_anchor_date, allow_advances, advance_limit_amount, advance_frequency')
      .single()

    if (response.error || !response.data) {
      return { ok: false, error: response.error?.message ?? 'Vyplatni nastaveni se nepodarilo ulozit.' }
    }

    revalidatePath('/ucet')
    revalidatePath('/workers')

    return {
      ok: true,
      settings: response.data as AccountPayrollSettingsResult extends { ok: true; settings: infer T }
        ? T
        : never,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Vyplatni nastaveni se nepodarilo ulozit.',
    }
  }
}
