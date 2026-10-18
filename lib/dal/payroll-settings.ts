import 'server-only'

import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { parsePayrollSettings, type PayrollSettingsInput } from '@/lib/payroll/settings-input'

export async function requirePayrollSettingsContext(companyId: string) {
  // Resolve the actual active membership before checking its role. Filtering to
  // admin memberships first could silently fall back to a different company.
  const access = await requireWorkerAccess()
  if (!access.ok || access.value.companyId !== companyId) throw new Error('Firma se změnila. Obnovte stránku před uložením nastavení.')
  if (!['company_admin', 'super_admin'].includes(access.value.role ?? '')) throw new Error('Nemáte oprávnění měnit výplatní nastavení této firmy.')
  return { companyId: access.value.companyId, supabase: await createSupabaseServerClient() }
}

/** Both settings screens use the same authorized, atomic alias update. */
export async function saveCompanyPayrollSettings(companyId: string, input: PayrollSettingsInput) {
  const payload = parsePayrollSettings(input)
  const context = await requirePayrollSettingsContext(companyId)
  const response = await context.supabase.from('company_payroll_settings')
    .upsert({ ...payload, company_id: context.companyId }, { onConflict: 'company_id' })
    .select('company_id, payroll_type, payroll_day_of_month, payroll_weekday, payroll_anchor_date, allow_advances, advance_limit_amount, advance_frequency')
    .single()
  if (response.error || !response.data) throw new Error(response.error?.message ?? 'Výplatní nastavení se nepodařilo uložit.')
  return response.data
}
