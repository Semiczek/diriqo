'use server'

import { revalidatePath } from 'next/cache'
import { saveCompanyPayrollSettings } from '@/lib/dal/payroll-settings'

export type AccountPayrollSettingsResult =
  | { ok: true; settings: {
      company_id: string
      payroll_type: string | null
      payroll_day_of_month: number | null
      payroll_weekday: number | null
      payroll_anchor_date: string | null
      allow_advances: boolean | null
      advance_limit_amount: number | null
      advance_frequency: string | null
    } }
  | { ok: false; error: string }

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
    const settings = await saveCompanyPayrollSettings(input.companyId?.trim() ?? '', {
      payType: input.payrollType,
      payday: input.payrollDayOfMonth,
      weekday: input.payrollWeekday,
      anchorDate: input.payrollAnchorDate,
      advancesEnabled: input.allowAdvances === true,
      advanceLimitAmount: input.advanceLimitAmount,
      advanceFrequency: input.advanceFrequency,
    })
    for (const path of ['/ucet', '/settings/company', '/workers', '/advance-requests', '/mobile/my']) revalidatePath(path)
    return { ok: true, settings }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Výplatní nastavení se nepodařilo uložit.' }
  }
}
