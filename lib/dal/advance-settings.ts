import 'server-only'
import type { SupabaseServerClient } from './auth'
import { parsePayday } from '@/lib/payroll/payday'

export type AdvanceSettings = {
  currency: string; payday: number | null; payType: string | null
  advancesAllowed: boolean; advanceLimitAmount: number | null; unsupportedLimit: boolean
}

/** Read only. Canonical settings exist per company; a stored false/NULL is not
 * permission to reuse a global profile's settings from a different company. */
export async function readAdvanceSettings(supabase: SupabaseServerClient, companyId: string, profileId?: string): Promise<AdvanceSettings> {
  const [company, settings, worker] = await Promise.all([
    supabase.from('companies').select('default_currency, currency').eq('id', companyId).single(),
    supabase.from('company_payroll_settings').select('payday_day, advances_enabled, advance_limit_type, advance_limit_amount, default_pay_type').eq('company_id', companyId).maybeSingle(),
    profileId ? supabase.from('worker_payment_settings').select('payday_day_override, advances_enabled_override, advance_limit_amount_override, pay_type_override').eq('company_id', companyId).eq('profile_id', profileId).eq('is_active', true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (company.error || settings.error || worker.error) throw new Error('Výplatní nastavení se nepodařilo načíst.')
  const currency = company.data?.default_currency || company.data?.currency
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('Firma nemá platnou měnu.')
  const day = worker.data?.payday_day_override ?? settings.data?.payday_day ?? null
  const amount = worker.data?.advance_limit_amount_override ?? settings.data?.advance_limit_amount ?? null
  return {
    currency, payday: parsePayday(day),
    payType: worker.data?.pay_type_override ?? settings.data?.default_pay_type ?? (settings.data ? null : 'monthly'),
    advancesAllowed: worker.data?.advances_enabled_override ?? (settings.data ? settings.data.advances_enabled === true : true),
    advanceLimitAmount: amount == null ? null : Number(amount),
    unsupportedLimit: worker.data?.advance_limit_amount_override == null && settings.data?.advance_limit_type === 'percent_of_earned',
  }
}

export async function readWorkerPaydayOverrides(supabase: SupabaseServerClient, companyId: string) {
  const overrides = new Map<string, { payday: number | null; payType: string | null }>()
  for (let offset = 0; offset < 100000; offset += 500) {
    const result = await supabase.from('worker_payment_settings').select('profile_id, payday_day_override, pay_type_override')
      .eq('company_id', companyId).eq('is_active', true).order('profile_id').range(offset, offset + 499)
    if (result.error) throw new Error('Individuální výplatní dny se nepodařilo načíst.')
    for (const row of result.data ?? []) overrides.set(row.profile_id, { payday: parsePayday(row.payday_day_override), payType: row.pay_type_override })
    if ((result.data?.length ?? 0) < 500) return overrides
  }
  throw new Error('Přehled individuálních výplatních dnů překročil podporovanou velikost.')
}
