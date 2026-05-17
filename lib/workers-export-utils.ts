import 'server-only'

const PAYROLL_ADVANCE_START_DAY = 19
const PAYROLL_ADVANCE_END_EXCLUSIVE_DAY = 18
const PAYROLL_ADVANCE_END_VISIBLE_DAY = 17

export function isValidMonthString(value: string | null | undefined) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

export function getTodayMonthString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatLocalDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveExportMonth(value: string | null | undefined): string {
  return typeof value === 'string' && isValidMonthString(value) ? value : getTodayMonthString()
}

export function getWorkMonthRange(monthString: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1
  const workStart = new Date(year, monthIndex, 1, 0, 0, 0, 0)
  const workEndExclusive = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0)
  const workEndVisible = new Date(year, monthIndex + 1, 0, 0, 0, 0, 0)

  return {
    workStartDate: formatLocalDateKey(workStart),
    workEndExclusiveDate: formatLocalDateKey(workEndExclusive),
    workStartIso: workStart.toISOString(),
    workEndExclusiveIso: workEndExclusive.toISOString(),
    workPeriodLabel: `${formatDateForExport(workStart)} - ${formatDateForExport(workEndVisible)}`,
  }
}

export function getAdvanceRange(monthString: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1
  const advanceStart = new Date(year, monthIndex, PAYROLL_ADVANCE_START_DAY, 0, 0, 0, 0)
  const advanceEndExclusive = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)
  const advanceEndVisible = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_VISIBLE_DAY, 0, 0, 0, 0)
  const payDate = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)

  return {
    advanceStartDate: formatLocalDateKey(advanceStart),
    advanceEndExclusiveDate: formatLocalDateKey(advanceEndExclusive),
    advancePeriodLabel: `${formatDateForExport(advanceStart)} - ${formatDateForExport(advanceEndVisible)}`,
    payDateLabel: formatDateForExport(payDate),
  }
}

export function getShiftHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return 0

  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.round(((end - start) / 1000 / 60 / 60) * 100) / 100
}

export function getEffectiveShiftHours(shift: {
  started_at?: string | null
  ended_at?: string | null
  hours_override?: number | string | null
}) {
  if (shift.hours_override != null && shift.hours_override !== '') {
    const parsed = Number(shift.hours_override)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return getShiftHours(shift.started_at ?? null, shift.ended_at ?? null)
}

export function numberOrZero(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatDateForExport(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export function formatDateTimeForExport(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function getWorkerDisplayName(profile: { full_name?: string | null; email?: string | null }) {
  return profile.full_name?.trim() || profile.email?.trim() || 'Bez jména'
}

export function doesDateRangeOverlap(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  rangeStartIso: string,
  rangeEndExclusiveIso: string,
) {
  if (!startValue && !endValue) return false

  const rangeStart = new Date(rangeStartIso).getTime()
  const rangeEnd = new Date(rangeEndExclusiveIso).getTime()
  const start = startValue ? new Date(startValue).getTime() : Number.NEGATIVE_INFINITY
  const end = endValue ? new Date(endValue).getTime() : Number.POSITIVE_INFINITY

  if ([rangeStart, rangeEnd, start, end].some((value) => Number.isNaN(value))) return false
  return start < rangeEnd && end >= rangeStart
}
