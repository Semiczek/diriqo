'use server'

import { revalidatePath } from 'next/cache'

import { COMPANY_MODULE_KEYS, type CompanyModuleKey } from '@/lib/company-settings-shared'
import { resolveCompanyTimeZone } from '@/lib/company-timezone'
import { getCompanyCountryConfig } from '@/lib/company-country-config'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type SettingsActionResult = {
  ok: boolean
  message: string
}

const ADMIN_ROLES = new Set(['super_admin', 'company_admin'])

type LogoUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string }

function asText(formData: FormData, key: string) {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function asLogoUrl(formData: FormData, key: string): LogoUrlResult {
  const value = asText(formData, key)
  if (!value) return { ok: true, value: null }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return { ok: true, value }
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return { ok: true, value: url.toString() }
    }
  } catch {
    // Invalid URLs are handled by the shared validation message below.
  }

  return { ok: false, message: 'Logo firmy musí být platná URL adresa začínající http://, https:// nebo /.' }
}

function asRequiredText(formData: FormData, key: string, fallback: string) {
  return asText(formData, key) ?? fallback
}

function asBusinessIdentifier(formData: FormData, key: string): LogoUrlResult {
  const value = asText(formData, key)
  if (!value) return { ok: true, value: null }

  if (value.length <= 64 && /^[\p{L}\p{N}\s./-]+$/u.test(value)) {
    return { ok: true, value }
  }

  return { ok: false, message: 'Registrační a daňové číslo může mít nejvýše 64 znaků a obsahovat písmena, čísla, mezery, lomítka, pomlčky nebo tečky.' }
}

function localeFromLanguage(language: string) {
  const normalized = language.trim().toLowerCase()
  if (normalized === 'cs' || normalized === 'sk') return 'cs-CZ'
  if (normalized === 'de') return 'de-DE'
  return 'en-GB'
}

function asBoolean(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

function asNumber(formData: FormData, key: string) {
  const value = asText(formData, key)
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function asInteger(formData: FormData, key: string) {
  const value = asNumber(formData, key)
  return value === null ? null : Math.trunc(value)
}

function enumValue<T extends string>(formData: FormData, key: string, allowed: readonly T[], fallback: T): T {
  const value = asText(formData, key)
  return allowed.includes(value as T) ? (value as T) : fallback
}

function nullablePayType(formData: FormData, key: string) {
  const value = asText(formData, key)
  if (!value) return null
  return ['after_shift', 'weekly', 'biweekly', 'monthly'].includes(value) ? value : null
}

function nullableBooleanOverride(formData: FormData, key: string) {
  const value = asText(formData, key)
  if (value === 'enabled') return true
  if (value === 'disabled') return false
  return null
}

async function requireCompanySettingsAccess() {
  const activeCompany = await requireHubAccess()
  const role = (activeCompany.role ?? '').toLowerCase()

  if (!ADMIN_ROLES.has(role)) {
    throw new Error('Nemáte oprávnění spravovat nastavení společnosti.')
  }

  const supabase = await createSupabaseServerClient()
  return { activeCompany, supabase }
}

function result(ok: boolean, message: string): SettingsActionResult {
  return { ok, message }
}

function revalidateSettings() {
  revalidatePath('/settings/company')
  revalidatePath('/')
  revalidatePath('/jobs')
  revalidatePath('/workers')
  revalidatePath('/invoices')
}

export async function updateCompanyBasicInfo(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()
    const logoUrl = asLogoUrl(formData, 'logo_url')
    const registrationNumber = asBusinessIdentifier(formData, 'registration_number')
    const taxNumber = asBusinessIdentifier(formData, 'tax_number')

    if (!logoUrl.ok) return result(false, logoUrl.message)
    if (!registrationNumber.ok) return result(false, registrationNumber.message)
    if (!taxNumber.ok) return result(false, taxNumber.message)

    const countryCode = asRequiredText(formData, 'country_code', 'CZ').toUpperCase()
    const countryConfig = getCompanyCountryConfig(countryCode)
    const language = asRequiredText(formData, 'default_language', countryConfig.defaultLanguage).toLowerCase()
    const currency = asRequiredText(formData, 'default_currency', countryConfig.defaultCurrency).toUpperCase()

    const { error } = await supabase
      .from('companies')
      .update({
        name: asRequiredText(formData, 'name', activeCompany.companyName ?? 'Diriqo'),
        country_code: countryCode,
        default_language: language,
        default_currency: currency,
        registration_number: registrationNumber.value,
        tax_number: taxNumber.value,
        company_number: registrationNumber.value,
        vat_number: taxNumber.value,
        ico: registrationNumber.value,
        dic: taxNumber.value,
        email: asText(formData, 'email'),
        phone: asText(formData, 'phone'),
        web: asText(formData, 'web'),
        logo_url: logoUrl.value,
        address: asText(formData, 'address'),
        billing_country: countryCode,
        currency,
        locale: localeFromLanguage(language),
        timezone: resolveCompanyTimeZone(asText(formData, 'timezone')),
      })
      .eq('id', activeCompany.companyId)

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Základní údaje byly uloženy.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Základní údaje se nepodařilo uložit.')
  }
}

export async function updateCompanyJobSettings(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()

    const { error } = await supabase.from('company_settings').upsert(
      {
        company_id: activeCompany.companyId,
        require_job_check: asBoolean(formData, 'require_job_check'),
        allow_multi_day_jobs: asBoolean(formData, 'allow_multi_day_jobs'),
        require_before_after_photos: asBoolean(formData, 'require_before_after_photos'),
        require_checklist_completion: asBoolean(formData, 'require_checklist_completion'),
        require_work_time_tracking: asBoolean(formData, 'require_work_time_tracking'),
        default_job_status_after_worker_done: enumValue(
          formData,
          'default_job_status_after_worker_done',
          ['waiting_check', 'done'] as const,
          'waiting_check',
        ),
      },
      { onConflict: 'company_id' },
    )

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Nastavení zakázek bylo uloženo.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Nastavení zakázek se nepodařilo uložit.')
  }
}

export async function updateCompanyPayrollSettings(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()

    const { error } = await supabase.from('company_payroll_settings').upsert(
      {
        company_id: activeCompany.companyId,
        default_worker_type: enumValue(formData, 'default_worker_type', ['employee', 'contractor'] as const, 'employee'),
        default_pay_type: enumValue(
          formData,
          'default_pay_type',
          ['after_shift', 'weekly', 'biweekly', 'monthly'] as const,
          'monthly',
        ),
        payday_day: asInteger(formData, 'payday_day'),
        payday_weekday: asInteger(formData, 'payday_weekday'),
        advances_enabled: asBoolean(formData, 'advances_enabled'),
        advance_limit_type: enumValue(
          formData,
          'advance_limit_type',
          ['monthly_amount', 'percent_of_earned'] as const,
          'monthly_amount',
        ),
        advance_limit_amount: asNumber(formData, 'advance_limit_amount'),
        advance_limit_percent: asNumber(formData, 'advance_limit_percent'),
        advance_frequency: enumValue(
          formData,
          'advance_frequency',
          ['per_shift', 'weekly', 'biweekly', 'monthly'] as const,
          'monthly',
        ),
        default_hourly_rate: asNumber(formData, 'default_hourly_rate'),
        default_contractor_cost_mode: enumValue(
          formData,
          'default_contractor_cost_mode',
          ['hourly', 'fixed_per_job', 'invoice'] as const,
          'hourly',
        ),
      },
      { onConflict: 'company_id' },
    )

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Nastavení pracovníků a výplat bylo uloženo.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Nastavení výplat se nepodařilo uložit.')
  }
}

export async function updateWorkerPaymentSettings(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()
    const profileId = asText(formData, 'profile_id')

    if (!profileId) return result(false, 'Chybí pracovník.')

    const memberResponse = await supabase
      .from('company_members')
      .select('id')
      .eq('company_id', activeCompany.companyId)
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .maybeSingle()

    if (memberResponse.error || !memberResponse.data) {
      return result(false, 'Pracovník nepatří do aktivní firmy.')
    }

    const { error } = await supabase.from('worker_payment_settings').upsert(
      {
        company_id: activeCompany.companyId,
        profile_id: profileId,
        worker_type: enumValue(formData, 'worker_type', ['employee', 'contractor'] as const, 'employee'),
        pay_type_override: nullablePayType(formData, 'pay_type_override'),
        payday_day_override: asInteger(formData, 'payday_day_override'),
        payday_weekday_override: asInteger(formData, 'payday_weekday_override'),
        hourly_rate: asNumber(formData, 'hourly_rate'),
        fixed_rate_per_job: asNumber(formData, 'fixed_rate_per_job'),
        advances_enabled_override: nullableBooleanOverride(formData, 'advances_enabled_override_mode'),
        advance_limit_amount_override: asNumber(formData, 'advance_limit_amount_override'),
        contractor_company_name: asText(formData, 'contractor_company_name'),
        contractor_registration_no: asText(formData, 'contractor_registration_no'),
        contractor_vat_no: asText(formData, 'contractor_vat_no'),
        contractor_invoice_required: asBoolean(formData, 'contractor_invoice_required'),
        is_active: true,
      },
      { onConflict: 'company_id,profile_id' },
    )

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Individuální nastavení pracovníka bylo uloženo.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Nastavení pracovníka se nepodařilo uložit.')
  }
}

export async function updateCompanyBillingSettings(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()

    const { error } = await supabase.from('company_billing_settings').upsert(
      {
        company_id: activeCompany.companyId,
        billing_enabled: asBoolean(formData, 'billing_enabled'),
        default_invoice_due_days: asInteger(formData, 'default_invoice_due_days') ?? 14,
        default_vat_rate: asNumber(formData, 'default_vat_rate') ?? 21,
        is_vat_payer: asBoolean(formData, 'is_vat_payer'),
        invoice_prefix: asRequiredText(formData, 'invoice_prefix', 'FV'),
        next_invoice_number: asInteger(formData, 'next_invoice_number') ?? 1,
        bank_account: asText(formData, 'bank_account'),
        iban: asText(formData, 'iban'),
        swift: asText(formData, 'swift'),
      },
      { onConflict: 'company_id' },
    )

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Nastavení fakturace bylo uloženo.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Nastavení fakturace se nepodařilo uložit.')
  }
}

export async function updateCompanyModules(formData: FormData): Promise<SettingsActionResult> {
  try {
    const { activeCompany, supabase } = await requireCompanySettingsAccess()
    const rows = COMPANY_MODULE_KEYS.map((moduleKey: CompanyModuleKey) => ({
      company_id: activeCompany.companyId,
      module_key: moduleKey,
      is_enabled: formData.get(`module_${moduleKey}`) === 'on',
    }))

    const { error } = await supabase
      .from('company_modules')
      .upsert(rows, { onConflict: 'company_id,module_key' })

    if (error) return result(false, error.message)

    revalidateSettings()
    return result(true, 'Nastavení modulů bylo uloženo.')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'Nastavení modulů se nepodařilo uložit.')
  }
}
