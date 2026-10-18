import { parsePayday } from './payday'

export type PayrollSettingsInput = {
  payType: unknown
  payday: unknown
  weekday: unknown
  advancesEnabled: boolean
  advanceLimitAmount: unknown
  advanceFrequency: unknown
  anchorDate?: unknown
  defaultWorkerType?: unknown
  advanceLimitType?: unknown
  advanceLimitPercent?: unknown
  defaultHourlyRate?: unknown
  defaultContractorCostMode?: unknown
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`Neplatná hodnota: ${label}.`)
  return value as T
}

export function nonnegative(value: unknown, label: string): number | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Neplatná hodnota: ${label}.`)
  const text = String(value).trim()
  if (!text) return null
  const number = Number(text.replace(',', '.'))
  if (!Number.isFinite(number) || number < 0) throw new Error(`Neplatná hodnota: ${label}.`)
  return number
}

export function parsePayrollSettings(input: PayrollSettingsInput) {
  const payType = choice(input.payType === 'shift' ? 'after_shift' : input.payType,
    ['after_shift', 'weekly', 'biweekly', 'monthly'] as const, 'typ výplaty')
  const payday = parsePayday(input.payday)
  const weekday = nonnegative(input.weekday, 'den v týdnu')
  if (weekday != null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
    throw new Error('Den v týdnu musí být celé číslo od 1 do 7.')
  }
  if (typeof input.advancesEnabled !== 'boolean') throw new Error('Neplatné povolení záloh.')
  const payload: Record<string, string | number | boolean | null> = {
    default_pay_type: payType,
    payroll_type: payType === 'after_shift' ? 'shift' : payType,
    payday_day: payday,
    payroll_day_of_month: payday,
    payday_weekday: weekday,
    payroll_weekday: weekday,
    advances_enabled: input.advancesEnabled,
    allow_advances: input.advancesEnabled,
    advance_limit_amount: nonnegative(input.advanceLimitAmount, 'limit záloh'),
    advance_frequency: choice(input.advanceFrequency, ['anytime', 'per_shift', 'weekly', 'biweekly', 'monthly'] as const, 'frekvence záloh'),
  }
  if (input.anchorDate !== undefined) {
    const date = input.anchorDate == null || input.anchorDate === '' ? null : String(input.anchorDate)
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Neplatné počáteční datum výplat.')
    payload.payroll_anchor_date = date
  }
  if (input.defaultWorkerType !== undefined) payload.default_worker_type = choice(input.defaultWorkerType, ['employee', 'contractor'] as const, 'typ pracovníka')
  if (input.advanceLimitType !== undefined) payload.advance_limit_type = choice(input.advanceLimitType, ['monthly_amount', 'percent_of_earned'] as const, 'typ limitu')
  if (input.advanceLimitPercent !== undefined) {
    const percent = nonnegative(input.advanceLimitPercent, 'procentní limit')
    if (percent != null && percent > 100) throw new Error('Procentní limit musí být od 0 do 100.')
    payload.advance_limit_percent = percent
  }
  if (input.defaultHourlyRate !== undefined) payload.default_hourly_rate = nonnegative(input.defaultHourlyRate, 'hodinová sazba')
  if (input.defaultContractorCostMode !== undefined) payload.default_contractor_cost_mode = choice(input.defaultContractorCostMode, ['hourly', 'fixed_per_job', 'invoice'] as const, 'režim externisty')
  return payload
}
