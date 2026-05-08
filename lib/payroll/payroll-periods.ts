import {
  formatMonthInputValue,
  formatDateKeyInTimeZone,
  getPartsFromDateInTimeZone,
  parseDateSafe,
  PRAGUE_TZ,
  wallTimeToDateInTimeZone,
} from '@/lib/date/prague-time'

export const PAYROLL_ADVANCE_START_DAY = 19
export const PAYROLL_ADVANCE_END_EXCLUSIVE_DAY = 18
export const PAYROLL_ADVANCE_END_VISIBLE_DAY = 17

export type PayrollAdvanceRequestLike = {
  payroll_month?: string | null
  paid_at?: string | null
  approved_at?: string | null
  reviewed_at?: string | null
  requested_at?: string | null
  created_at: string | null
}

export type WorkerAdvanceLike = {
  profile_id: string | null
  note?: string | null
}

export function normalizePayrollMonthValue(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!match) return null
  return `${match[1]}-${match[2]}`
}

export function getPayrollMonthValueFromDateString(value: string | null | undefined, timeZone = PRAGUE_TZ): string | null {
  const date = parseDateSafe(value, timeZone)
  if (!date) return null

  const parts = getPartsFromDateInTimeZone(date, timeZone)
  const payrollMonth =
    parts.day >= PAYROLL_ADVANCE_START_DAY
      ? wallTimeToDateInTimeZone(parts.year, parts.month + 1, 1, 0, 0, 0, timeZone)
      : wallTimeToDateInTimeZone(parts.year, parts.month, 1, 0, 0, 0, timeZone)

  return formatMonthInputValue(payrollMonth, timeZone)
}

export function getAdvanceRequestPayrollMonth(row: PayrollAdvanceRequestLike, timeZone = PRAGUE_TZ): string | null {
  return (
    normalizePayrollMonthValue(row.payroll_month) ||
    getPayrollMonthValueFromDateString(row.paid_at, timeZone) ||
    getPayrollMonthValueFromDateString(row.approved_at || row.reviewed_at, timeZone) ||
    getPayrollMonthValueFromDateString(row.requested_at || row.created_at, timeZone)
  )
}

export function isWorkerAdvanceBackfilledFromRequest<
  TRequest extends { id: string; profile_id: string | null },
  TAdvance extends WorkerAdvanceLike,
>(row: TRequest, workerAdvances: TAdvance[]) {
  const requestRef = `(${row.id})`
  return workerAdvances.some(
    (advance) =>
      advance.profile_id === row.profile_id &&
      typeof advance.note === 'string' &&
      advance.note.includes(requestRef)
  )
}

export function getPayrollRangeFromMonthValue(value: string, timeZone = PRAGUE_TZ) {
  const [yearRaw, monthRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = wallTimeToDateInTimeZone(year, month, PAYROLL_ADVANCE_START_DAY, 0, 0, 0, timeZone)
  const endExclusive = wallTimeToDateInTimeZone(year, month + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, timeZone)
  const endVisible = wallTimeToDateInTimeZone(year, month + 1, PAYROLL_ADVANCE_END_VISIBLE_DAY, 0, 0, 0, timeZone)
  const payDate = wallTimeToDateInTimeZone(year, month + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, timeZone)

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone,
    }).format(date)

  return {
    startDate: formatDateKeyInTimeZone(start, timeZone),
    endExclusiveDate: formatDateKeyInTimeZone(endExclusive, timeZone),
    periodLabel: `${formatDate(start)} - ${formatDate(endVisible)}`,
    payDateLabel: formatDate(payDate),
  }
}
