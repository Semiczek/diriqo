import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase-server'

export const COMPANY_MODULE_KEYS = [
  'jobs',
  'workers',
  'shifts',
  'finance',
  'calendar',
  'quotes',
  'invoices',
  'photos',
  'customer_portal',
  'public_leads',
  'email',
  'payroll',
] as const

export type CompanyModuleKey = (typeof COMPANY_MODULE_KEYS)[number]
export type WorkerType = 'employee' | 'contractor'
export type PayType = 'after_shift' | 'weekly' | 'biweekly' | 'monthly'
export type ContractorCostMode = 'hourly' | 'fixed_per_job' | 'invoice'

export type CompanySettings = {
  company_id: string
  require_job_check: boolean
  allow_multi_day_jobs: boolean
  require_before_after_photos: boolean
  require_checklist_completion: boolean
  require_work_time_tracking: boolean
  default_job_status_after_worker_done: 'waiting_check' | 'done'
}

export type CompanyPayrollSettings = {
  company_id: string
  default_worker_type: WorkerType
  default_pay_type: PayType
  payday_day: number | null
  payday_weekday: number | null
  advances_enabled: boolean
  advance_limit_type: 'monthly_amount' | 'percent_of_earned'
  advance_limit_amount: number | null
  advance_limit_percent: number | null
  advance_frequency: 'per_shift' | 'weekly' | 'biweekly' | 'monthly'
  default_hourly_rate: number | null
  default_contractor_cost_mode: ContractorCostMode
}

export type WorkerPaymentSettings = {
  company_id: string
  profile_id: string
  worker_type: WorkerType
  pay_type_override: PayType | null
  payday_day_override: number | null
  payday_weekday_override: number | null
  hourly_rate: number | null
  fixed_rate_per_job: number | null
  advances_enabled_override: boolean | null
  advance_limit_amount_override: number | null
  contractor_company_name: string | null
  contractor_registration_no: string | null
  contractor_vat_no: string | null
  contractor_invoice_required: boolean
  is_active: boolean
}

export type CompanyBillingSettings = {
  company_id: string
  billing_enabled: boolean
  default_invoice_due_days: number
  default_vat_rate: number
  is_vat_payer: boolean
  invoice_prefix: string
  next_invoice_number: number
  bank_account: string | null
  iban: string | null
  swift: string | null
}

export type EffectiveWorkerPaymentSettings = {
  appliesToPayroll: boolean
  workerType: WorkerType
  workerTypeLabel: string
  payType: PayType | null
  payTypeLabel: string
  paydayDay: number | null
  paydayWeekday: number | null
  hourlyRate: number
  fixedRatePerJob: number | null
  advancesEnabled: boolean
  advanceLimitAmount: number | null
  contractorCostMode: ContractorCostMode
  contractorCostModeLabel: string
  usesWorkerOverride: boolean
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePayType(value: unknown): PayType {
  if (value === 'after_shift' || value === 'shift') return 'after_shift'
  if (value === 'weekly' || value === 'biweekly' || value === 'monthly') return value
  return 'monthly'
}

function normalizeWorkerType(value: unknown): WorkerType {
  return value === 'contractor' ? 'contractor' : 'employee'
}

function normalizeContractorCostMode(value: unknown): ContractorCostMode {
  if (value === 'fixed_per_job' || value === 'invoice') return value
  return 'hourly'
}

function defaultCompanySettings(companyId: string): CompanySettings {
  return {
    company_id: companyId,
    require_job_check: true,
    allow_multi_day_jobs: true,
    require_before_after_photos: false,
    require_checklist_completion: false,
    require_work_time_tracking: true,
    default_job_status_after_worker_done: 'waiting_check',
  }
}

function defaultPayrollSettings(companyId: string): CompanyPayrollSettings {
  return {
    company_id: companyId,
    default_worker_type: 'employee',
    default_pay_type: 'monthly',
    payday_day: null,
    payday_weekday: null,
    advances_enabled: true,
    advance_limit_type: 'monthly_amount',
    advance_limit_amount: null,
    advance_limit_percent: null,
    advance_frequency: 'monthly',
    default_hourly_rate: null,
    default_contractor_cost_mode: 'hourly',
  }
}

function defaultBillingSettings(companyId: string): CompanyBillingSettings {
  return {
    company_id: companyId,
    billing_enabled: true,
    default_invoice_due_days: 14,
    default_vat_rate: 21,
    is_vat_payer: false,
    invoice_prefix: 'FV',
    next_invoice_number: 1,
    bank_account: null,
    iban: null,
    swift: null,
  }
}

function mapCompanySettings(row: Record<string, unknown> | null, companyId: string): CompanySettings {
  return {
    ...defaultCompanySettings(companyId),
    ...(row ?? {}),
    company_id: companyId,
    default_job_status_after_worker_done:
      row?.default_job_status_after_worker_done === 'done' ? 'done' : 'waiting_check',
  }
}

function mapPayrollSettings(row: Record<string, unknown> | null, companyId: string): CompanyPayrollSettings {
  const fallback = defaultPayrollSettings(companyId)
  const legacyPayType = normalizePayType(row?.payroll_type)

  return {
    company_id: companyId,
    default_worker_type: normalizeWorkerType(row?.default_worker_type),
    default_pay_type: normalizePayType(row?.default_pay_type ?? legacyPayType),
    payday_day: toNumber(row?.payday_day ?? row?.payroll_day_of_month),
    payday_weekday: toNumber(row?.payday_weekday ?? row?.payroll_weekday),
    advances_enabled:
      typeof row?.advances_enabled === 'boolean'
        ? row.advances_enabled
        : typeof row?.allow_advances === 'boolean'
          ? row.allow_advances
          : fallback.advances_enabled,
    advance_limit_type:
      row?.advance_limit_type === 'percent_of_earned' ? 'percent_of_earned' : 'monthly_amount',
    advance_limit_amount: toNumber(row?.advance_limit_amount),
    advance_limit_percent: toNumber(row?.advance_limit_percent),
    advance_frequency:
      row?.advance_frequency === 'per_shift' ||
      row?.advance_frequency === 'weekly' ||
      row?.advance_frequency === 'biweekly'
        ? row.advance_frequency
        : 'monthly',
    default_hourly_rate: toNumber(row?.default_hourly_rate),
    default_contractor_cost_mode: normalizeContractorCostMode(row?.default_contractor_cost_mode),
  }
}

function mapWorkerPaymentSettings(
  row: Record<string, unknown> | null,
  companyId: string,
  profileId: string,
): WorkerPaymentSettings {
  return {
    company_id: companyId,
    profile_id: profileId,
    worker_type: normalizeWorkerType(row?.worker_type),
    pay_type_override: row?.pay_type_override ? normalizePayType(row.pay_type_override) : null,
    payday_day_override: toNumber(row?.payday_day_override),
    payday_weekday_override: toNumber(row?.payday_weekday_override),
    hourly_rate: toNumber(row?.hourly_rate),
    fixed_rate_per_job: toNumber(row?.fixed_rate_per_job),
    advances_enabled_override:
      typeof row?.advances_enabled_override === 'boolean' ? row.advances_enabled_override : null,
    advance_limit_amount_override: toNumber(row?.advance_limit_amount_override),
    contractor_company_name: typeof row?.contractor_company_name === 'string' ? row.contractor_company_name : null,
    contractor_registration_no: typeof row?.contractor_registration_no === 'string' ? row.contractor_registration_no : null,
    contractor_vat_no: typeof row?.contractor_vat_no === 'string' ? row.contractor_vat_no : null,
    contractor_invoice_required: row?.contractor_invoice_required === true,
    is_active: row?.is_active !== false,
  }
}

function mapBillingSettings(row: Record<string, unknown> | null, companyId: string): CompanyBillingSettings {
  const fallback = defaultBillingSettings(companyId)

  return {
    company_id: companyId,
    billing_enabled: row?.billing_enabled === true,
    default_invoice_due_days: toNumber(row?.default_invoice_due_days) ?? fallback.default_invoice_due_days,
    default_vat_rate: toNumber(row?.default_vat_rate) ?? fallback.default_vat_rate,
    is_vat_payer: row?.is_vat_payer === true,
    invoice_prefix: typeof row?.invoice_prefix === 'string' && row.invoice_prefix.trim() ? row.invoice_prefix.trim() : 'FV',
    next_invoice_number: toNumber(row?.next_invoice_number) ?? 1,
    bank_account: typeof row?.bank_account === 'string' ? row.bank_account : null,
    iban: typeof row?.iban === 'string' ? row.iban : null,
    swift: typeof row?.swift === 'string' ? row.swift : null,
  }
}

async function selectOrCreate(
  table: string,
  companyId: string,
  defaults: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const supabase = await createSupabaseServerClient()
  const response = await supabase.from(table).select('*').eq('company_id', companyId).maybeSingle()

  if (response.data) return response.data as Record<string, unknown>

  if (response.error && response.error.code !== 'PGRST116') {
    return null
  }

  const insertResponse = await supabase
    .from(table)
    .insert({ company_id: companyId, ...defaults })
    .select('*')
    .maybeSingle()

  return (insertResponse.data as Record<string, unknown> | null) ?? null
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const row = await selectOrCreate('company_settings', companyId, {})
  return mapCompanySettings(row, companyId)
}

export async function getCompanyPayrollSettings(companyId: string): Promise<CompanyPayrollSettings> {
  const row = await selectOrCreate('company_payroll_settings', companyId, {})
  return mapPayrollSettings(row, companyId)
}

export async function getCompanyBillingSettings(companyId: string): Promise<CompanyBillingSettings> {
  const row = await selectOrCreate('company_billing_settings', companyId, {})
  return mapBillingSettings(row, companyId)
}

export async function getCompanyModules(companyId: string): Promise<Record<CompanyModuleKey, boolean>> {
  const supabase = await createSupabaseServerClient()
  const response = await supabase
    .from('company_modules')
    .select('module_key, is_enabled')
    .eq('company_id', companyId)

  const modules = Object.fromEntries(COMPANY_MODULE_KEYS.map((key) => [key, true])) as Record<
    CompanyModuleKey,
    boolean
  >

  if (!response.error) {
    for (const row of response.data ?? []) {
      if (COMPANY_MODULE_KEYS.includes(row.module_key as CompanyModuleKey)) {
        modules[row.module_key as CompanyModuleKey] = row.is_enabled !== false
      }
    }
  }

  const missingKeys = COMPANY_MODULE_KEYS.filter(
    (key) => !(response.data ?? []).some((row) => row.module_key === key),
  )

  if (missingKeys.length > 0) {
    await supabase.from('company_modules').upsert(
      missingKeys.map((module_key) => ({ company_id: companyId, module_key, is_enabled: true })),
      { onConflict: 'company_id,module_key' },
    )
  }

  return modules
}

export async function getWorkerPaymentSettings(
  companyId: string,
  profileId: string,
): Promise<WorkerPaymentSettings> {
  const supabase = await createSupabaseServerClient()
  const response = await supabase
    .from('worker_payment_settings')
    .select('*')
    .eq('company_id', companyId)
    .eq('profile_id', profileId)
    .maybeSingle()

  if (response.data) {
    return mapWorkerPaymentSettings(response.data as Record<string, unknown>, companyId, profileId)
  }

  const profileResponse = await supabase
    .from('profiles')
    .select('worker_type, hourly_rate, contractor_default_rate')
    .eq('id', profileId)
    .maybeSingle()

  const profile = (profileResponse.data ?? null) as Record<string, unknown> | null
  const defaultRow = {
    company_id: companyId,
    profile_id: profileId,
    worker_type: normalizeWorkerType(profile?.worker_type),
    hourly_rate: toNumber(profile?.hourly_rate ?? profile?.contractor_default_rate),
  }

  const insertResponse = await supabase
    .from('worker_payment_settings')
    .insert(defaultRow)
    .select('*')
    .maybeSingle()

  return mapWorkerPaymentSettings(
    (insertResponse.data as Record<string, unknown> | null) ?? defaultRow,
    companyId,
    profileId,
  )
}

export async function getEffectiveWorkerPaymentSettings(
  companyId: string,
  profileId: string,
): Promise<EffectiveWorkerPaymentSettings> {
  const [companySettings, workerSettings] = await Promise.all([
    getCompanyPayrollSettings(companyId),
    getWorkerPaymentSettings(companyId, profileId),
  ])

  const workerType = workerSettings.worker_type || companySettings.default_worker_type
  const isContractor = workerType === 'contractor'
  const payType = workerSettings.pay_type_override ?? companySettings.default_pay_type
  const contractorCostMode = companySettings.default_contractor_cost_mode

  return {
    appliesToPayroll: !isContractor,
    workerType,
    workerTypeLabel: isContractor ? 'Externista / subdodavatel' : 'Interní pracovník',
    payType: isContractor ? null : payType,
    payTypeLabel: isContractor ? 'Nevztahuje se' : getPayTypeLabel(payType),
    paydayDay: workerSettings.payday_day_override ?? companySettings.payday_day,
    paydayWeekday: workerSettings.payday_weekday_override ?? companySettings.payday_weekday,
    hourlyRate: workerSettings.hourly_rate ?? companySettings.default_hourly_rate ?? 0,
    fixedRatePerJob: workerSettings.fixed_rate_per_job,
    advancesEnabled: isContractor
      ? false
      : (workerSettings.advances_enabled_override ?? companySettings.advances_enabled),
    advanceLimitAmount:
      workerSettings.advance_limit_amount_override ?? companySettings.advance_limit_amount,
    contractorCostMode,
    contractorCostModeLabel: getContractorCostModeLabel(contractorCostMode),
    usesWorkerOverride:
      Boolean(workerSettings.pay_type_override) ||
      workerSettings.hourly_rate !== null ||
      workerSettings.advances_enabled_override !== null,
  }
}

export function getPayTypeLabel(payType: PayType | null) {
  if (payType === 'after_shift') return 'Po směně'
  if (payType === 'weekly') return 'Týdně'
  if (payType === 'biweekly') return 'Každých 14 dní'
  if (payType === 'monthly') return 'Měsíčně'
  return 'Nevztahuje se'
}

export function getContractorCostModeLabel(mode: ContractorCostMode) {
  if (mode === 'fixed_per_job') return 'Fixně za zakázku'
  if (mode === 'invoice') return 'Fakturou'
  return 'Hodinově'
}

export function calculateJobProfit(input: {
  revenue: number
  internalLaborCost: number
  contractorCost: number
  directCosts: number
}) {
  return input.revenue - input.internalLaborCost - input.contractorCost - input.directCosts
}
