export const PRAGUE_TZ = 'Europe/Prague'

export type PragueDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function getOffsetMinutesForPrague(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TZ,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0'
  const normalized = tzName.replace('UTC', 'GMT')
  const match = normalized.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)

  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] ?? '0')
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

export function getPraguePartsFromDate(date: Date): PragueDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

export function pragueWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date {
  const firstGuessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstGuessDate = new Date(firstGuessUtcMs)
  const firstOffsetMinutes = getOffsetMinutesForPrague(firstGuessDate)

  const correctedUtcMs = firstGuessUtcMs - firstOffsetMinutes * 60_000
  const correctedDate = new Date(correctedUtcMs)
  const correctedOffsetMinutes = getOffsetMinutesForPrague(correctedDate)

  return new Date(firstGuessUtcMs - correctedOffsetMinutes * 60_000)
}

export function parseDateSafe(value: string | Date | null | undefined): Date | null {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const hasTimezone =
    trimmed.endsWith('Z') ||
    /[+-]\d{2}:\d{2}$/.test(trimmed) ||
    /[+-]\d{4}$/.test(trimmed)

  if (hasTimezone) {
    const direct = new Date(trimmed)
    return Number.isNaN(direct.getTime()) ? null : direct
  }

  const normalized = trimmed.replace(' ', 'T')

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  )

  if (match) {
    const [, year, month, day, hour, minute, second] = match

    return pragueWallTimeToDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0')
    )
  }

  const fallback = new Date(normalized)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

export function formatPragueDateKey(date: Date): string {
  const parts = getPraguePartsFromDate(date)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

export function formatMonthInputValue(date: Date): string {
  const parts = getPraguePartsFromDate(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

export function getCurrentMonthValuePrague(): string {
  return formatMonthInputValue(new Date())
}

export function getPragueWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addPragueDays(date: Date, days: number): Date {
  const parts = getPraguePartsFromDate(date)
  return pragueWallTimeToDate(parts.year, parts.month, parts.day + days, parts.hour, parts.minute, parts.second)
}

export function getDaysInMonth(date: Date): number {
  const parts = getPraguePartsFromDate(date)
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()
}

export function getNowPrague(): Date {
  return new Date()
}

export function startOfTodayPrague(): Date {
  const nowParts = getPraguePartsFromDate(new Date())
  return pragueWallTimeToDate(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0)
}

export function endOfTodayPrague(): Date {
  const nowParts = getPraguePartsFromDate(new Date())
  return pragueWallTimeToDate(nowParts.year, nowParts.month, nowParts.day, 23, 59, 59)
}

export function startOfTomorrowPrague(): Date {
  const todayParts = getPraguePartsFromDate(new Date())
  return pragueWallTimeToDate(todayParts.year, todayParts.month, todayParts.day + 1, 0, 0, 0)
}

export function endOfTomorrowPrague(): Date {
  const todayParts = getPraguePartsFromDate(new Date())
  const dayAfterTomorrowStart = pragueWallTimeToDate(
    todayParts.year,
    todayParts.month,
    todayParts.day + 2,
    0,
    0,
    0
  )

  return new Date(dayAfterTomorrowStart.getTime() - 1)
}

export function startOfMonthPrague(): Date {
  const nowParts = getPraguePartsFromDate(new Date())
  return pragueWallTimeToDate(nowParts.year, nowParts.month, 1, 0, 0, 0)
}

export function endOfMonthPrague(): Date {
  const nowParts = getPraguePartsFromDate(new Date())
  const nextMonthYear = nowParts.month === 12 ? nowParts.year + 1 : nowParts.year
  const nextMonth = nowParts.month === 12 ? 1 : nowParts.month + 1
  const nextMonthStart = pragueWallTimeToDate(nextMonthYear, nextMonth, 1, 0, 0, 0)
  return new Date(nextMonthStart.getTime() - 1)
}

export function startOfWeekPrague(): Date {
  const nowParts = getPraguePartsFromDate(new Date())
  const todayStart = pragueWallTimeToDate(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0)
  const weekday = getPragueWeekday(nowParts.year, nowParts.month, nowParts.day)
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday
  return addPragueDays(todayStart, diffToMonday)
}

export function endOfWeekPrague(): Date {
  const weekStart = startOfWeekPrague()
  const weekStartParts = getPraguePartsFromDate(weekStart)
  return pragueWallTimeToDate(
    weekStartParts.year,
    weekStartParts.month,
    weekStartParts.day + 6,
    23,
    59,
    59
  )
}

export function shiftMonthRange(start: Date, diff: number) {
  const parts = getPraguePartsFromDate(start)
  const shiftedStart = pragueWallTimeToDate(parts.year, parts.month + diff, 1, 0, 0, 0)
  const shiftedParts = getPraguePartsFromDate(shiftedStart)
  const nextMonthStart = pragueWallTimeToDate(
    shiftedParts.year,
    shiftedParts.month + 1,
    1,
    0,
    0,
    0
  )

  return {
    start: shiftedStart,
    end: new Date(nextMonthStart.getTime() - 1),
  }
}

export function getMonthRangeFromValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  const isValid = /^\d{4}-\d{2}$/.test(normalized)
  const effectiveValue = isValid ? normalized : getCurrentMonthValuePrague()
  const [yearRaw, monthRaw] = effectiveValue.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = pragueWallTimeToDate(year, month, 1, 0, 0, 0)
  const nextMonthStart = pragueWallTimeToDate(year, month + 1, 1, 0, 0, 0)
  const end = new Date(nextMonthStart.getTime() - 1)
  const label = new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone: PRAGUE_TZ,
  }).format(start)

  return {
    value: effectiveValue,
    start,
    end,
    label,
  }
}

export function overlapsRange(
  startAt: string | Date | null,
  endAt: string | Date | null,
  rangeStart: Date,
  rangeEnd: Date
): boolean {
  if (!startAt && !endAt) return false

  const start = startAt instanceof Date ? startAt : parseDateSafe(startAt) ?? parseDateSafe(endAt)
  const end = endAt instanceof Date ? endAt : parseDateSafe(endAt) ?? start

  if (!start || !end) return false

  return start <= rangeEnd && end >= rangeStart
}
