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
