export type WorkerType = 'employee' | 'contractor'
export type PayrollType = 'shift' | 'weekly' | 'biweekly' | 'monthly'
export type AdvanceFrequency = 'anytime' | 'weekly' | 'monthly'
export type ContractorBillingType = 'hourly' | 'fixed' | 'invoice'

export type CompanyPayrollSettingsLike = {
  payroll_type?: string | null
  payroll_day_of_month?: number | string | null
  payroll_weekday?: number | string | null
  payroll_anchor_date?: string | null
  allow_advances?: boolean | null
  advance_limit_amount?: number | string | null
  advance_frequency?: string | null
} | null

export type WorkerPayrollLike = {
  worker_type?: string | null
  use_custom_payroll?: boolean | null
  custom_payroll_type?: string | null
  custom_payroll_day_of_month?: number | string | null
  custom_payroll_weekday?: number | string | null
  custom_payroll_anchor_date?: string | null
  allow_advances_override?: boolean | null
  advance_limit_amount_override?: number | string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | string | null
} | null

export type EffectivePayrollSettings = {
  applies: boolean
  label: string
  payrollType: PayrollType | null
  payrollTypeLabel: string
  payrollDayOfMonth: number | null
  payrollWeekday: number | null
  payrollAnchorDate: string | null
  advancesAllowed: boolean
  advanceLimitAmount: number | null
  advanceFrequency: AdvanceFrequency | null
  usesCompanySettings: boolean
}

function normalizeEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  const normalized = (value ?? '').trim().toLowerCase()
  return allowed.includes(normalized as T) ? (normalized as T) : fallback
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getWorkerType(worker: WorkerPayrollLike): WorkerType {
  return normalizeEnum(worker?.worker_type, ['employee', 'contractor'] as const, 'employee')
}

export function getPayrollType(value: string | null | undefined): PayrollType {
  return normalizeEnum(value, ['shift', 'weekly', 'biweekly', 'monthly'] as const, 'monthly')
}

export function getAdvanceFrequency(value: string | null | undefined): AdvanceFrequency | null {
  if (!value) return null
  return normalizeEnum(value, ['anytime', 'weekly', 'monthly'] as const, 'monthly')
}

export function getContractorBillingType(value: string | null | undefined): ContractorBillingType {
  return normalizeEnum(value, ['hourly', 'fixed', 'invoice'] as const, 'hourly')
}

export function getWorkerTypeLabel(workerType: string | null | undefined) {
  return getWorkerType({ worker_type: workerType }) === 'contractor'
    ? 'Externí / subdodavatel'
    : 'Interní pracovník'
}

export function getPayrollTypeLabel(payrollType: string | null | undefined) {
  const normalized = getPayrollType(payrollType)
  if (normalized === 'shift') return 'Po směně'
  if (normalized === 'weekly') return 'Týdně'
  if (normalized === 'biweekly') return 'Jednou za 14 dní'
  return 'Měsíčně'
}

export function getAdvanceFrequencyLabel(value: string | null | undefined) {
  const normalized = getAdvanceFrequency(value)
  if (normalized === 'anytime') return 'Kdykoliv'
  if (normalized === 'weekly') return 'Týdně'
  if (normalized === 'monthly') return 'Měsíčně'
  return 'Bez omezení'
}

export function getContractorBillingTypeLabel(value: string | null | undefined) {
  const normalized = getContractorBillingType(value)
  if (normalized === 'fixed') return 'Fixní částka'
  if (normalized === 'invoice') return 'Na fakturu'
  return 'Hodinově'
}

export function getEffectivePayrollSettings(
  worker: WorkerPayrollLike,
  companySettings: CompanyPayrollSettingsLike
): EffectivePayrollSettings {
  if (getWorkerType(worker) === 'contractor') {
    return {
      applies: false,
      label: 'Externí pracovník / subdodavatel',
      payrollType: null,
      payrollTypeLabel: 'Nevztahuje se',
      payrollDayOfMonth: null,
      payrollWeekday: null,
      payrollAnchorDate: null,
      advancesAllowed: false,
      advanceLimitAmount: null,
      advanceFrequency: null,
      usesCompanySettings: false,
    }
  }

  const usesCustom = Boolean(worker?.use_custom_payroll)
  const payrollType = getPayrollType(
    usesCustom ? worker?.custom_payroll_type : companySettings?.payroll_type
  )

  return {
    applies: true,
    label: usesCustom ? 'Individuální nastavení pracovníka' : 'Používá firemní nastavení výplat.',
    payrollType,
    payrollTypeLabel: getPayrollTypeLabel(payrollType),
    payrollDayOfMonth: toNullableNumber(
      usesCustom ? worker?.custom_payroll_day_of_month : companySettings?.payroll_day_of_month
    ),
    payrollWeekday: toNullableNumber(
      usesCustom ? worker?.custom_payroll_weekday : companySettings?.payroll_weekday
    ),
    payrollAnchorDate: usesCustom
      ? worker?.custom_payroll_anchor_date ?? null
      : companySettings?.payroll_anchor_date ?? null,
    advancesAllowed:
      worker?.allow_advances_override ??
      companySettings?.allow_advances ??
      true,
    advanceLimitAmount:
      toNullableNumber(worker?.advance_limit_amount_override) ??
      toNullableNumber(companySettings?.advance_limit_amount),
    advanceFrequency: getAdvanceFrequency(companySettings?.advance_frequency),
    usesCompanySettings: !usesCustom,
  }
}
