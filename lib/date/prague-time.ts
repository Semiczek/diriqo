export const PRAGUE_TZ = 'Europe/Prague'

export type PragueDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function getOffsetMinutesForTimeZone(date: Date, timeZone = PRAGUE_TZ): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
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

export function getOffsetMinutesForPrague(date: Date): number {
  return getOffsetMinutesForTimeZone(date, PRAGUE_TZ)
}

export function getPartsFromDateInTimeZone(date: Date, timeZone = PRAGUE_TZ): PragueDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
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

export function getPraguePartsFromDate(date: Date): PragueDateParts {
  return getPartsFromDateInTimeZone(date, PRAGUE_TZ)
}

export function wallTimeToDateInTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone = PRAGUE_TZ
): Date {
  const firstGuessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstGuessDate = new Date(firstGuessUtcMs)
  const firstOffsetMinutes = getOffsetMinutesForTimeZone(firstGuessDate, timeZone)

  const correctedUtcMs = firstGuessUtcMs - firstOffsetMinutes * 60_000
  const correctedDate = new Date(correctedUtcMs)
  const correctedOffsetMinutes = getOffsetMinutesForTimeZone(correctedDate, timeZone)

  return new Date(firstGuessUtcMs - correctedOffsetMinutes * 60_000)
}

export function pragueWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date {
  return wallTimeToDateInTimeZone(year, month, day, hour, minute, second, PRAGUE_TZ)
}

export function parseDateSafe(value: string | Date | null | undefined, timeZone = PRAGUE_TZ): Date | null {
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

    return wallTimeToDateInTimeZone(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0'),
      timeZone
    )
  }

  const fallback = new Date(normalized)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

export function formatDateKeyInTimeZone(date: Date, timeZone = PRAGUE_TZ): string {
  const parts = getPartsFromDateInTimeZone(date, timeZone)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

export function formatPragueDateKey(date: Date): string {
  return formatDateKeyInTimeZone(date, PRAGUE_TZ)
}

export function formatMonthInputValue(date: Date, timeZone = PRAGUE_TZ): string {
  const parts = getPartsFromDateInTimeZone(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

export function getCurrentMonthValuePrague(timeZone = PRAGUE_TZ): string {
  return formatMonthInputValue(new Date(), timeZone)
}

export function getPragueWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addPragueDays(date: Date, days: number, timeZone = PRAGUE_TZ): Date {
  const parts = getPartsFromDateInTimeZone(date, timeZone)
  return wallTimeToDateInTimeZone(parts.year, parts.month, parts.day + days, parts.hour, parts.minute, parts.second, timeZone)
}

export function getDaysInMonth(date: Date, timeZone = PRAGUE_TZ): number {
  const parts = getPartsFromDateInTimeZone(date, timeZone)
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()
}

export function getNowPrague(): Date {
  return new Date()
}

export function startOfTodayPrague(timeZone = PRAGUE_TZ): Date {
  const nowParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  return wallTimeToDateInTimeZone(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0, timeZone)
}

export function endOfTodayPrague(timeZone = PRAGUE_TZ): Date {
  const nowParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  return wallTimeToDateInTimeZone(nowParts.year, nowParts.month, nowParts.day, 23, 59, 59, timeZone)
}

export function startOfTomorrowPrague(timeZone = PRAGUE_TZ): Date {
  const todayParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  return wallTimeToDateInTimeZone(todayParts.year, todayParts.month, todayParts.day + 1, 0, 0, 0, timeZone)
}

export function endOfTomorrowPrague(timeZone = PRAGUE_TZ): Date {
  const todayParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  const dayAfterTomorrowStart = wallTimeToDateInTimeZone(
    todayParts.year,
    todayParts.month,
    todayParts.day + 2,
    0,
    0,
    0,
    timeZone
  )

  return new Date(dayAfterTomorrowStart.getTime() - 1)
}

export function startOfMonthPrague(timeZone = PRAGUE_TZ): Date {
  const nowParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  return wallTimeToDateInTimeZone(nowParts.year, nowParts.month, 1, 0, 0, 0, timeZone)
}

export function endOfMonthPrague(timeZone = PRAGUE_TZ): Date {
  const nowParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  const nextMonthYear = nowParts.month === 12 ? nowParts.year + 1 : nowParts.year
  const nextMonth = nowParts.month === 12 ? 1 : nowParts.month + 1
  const nextMonthStart = wallTimeToDateInTimeZone(nextMonthYear, nextMonth, 1, 0, 0, 0, timeZone)
  return new Date(nextMonthStart.getTime() - 1)
}

export function startOfWeekPrague(timeZone = PRAGUE_TZ): Date {
  const nowParts = getPartsFromDateInTimeZone(new Date(), timeZone)
  const todayStart = wallTimeToDateInTimeZone(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0, timeZone)
  const weekday = getPragueWeekday(nowParts.year, nowParts.month, nowParts.day)
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday
  return addPragueDays(todayStart, diffToMonday, timeZone)
}

export function endOfWeekPrague(timeZone = PRAGUE_TZ): Date {
  const weekStart = startOfWeekPrague(timeZone)
  const weekStartParts = getPartsFromDateInTimeZone(weekStart, timeZone)
  return wallTimeToDateInTimeZone(
    weekStartParts.year,
    weekStartParts.month,
    weekStartParts.day + 6,
    23,
    59,
    59,
    timeZone
  )
}

export function shiftMonthRange(start: Date, diff: number, timeZone = PRAGUE_TZ) {
  const parts = getPartsFromDateInTimeZone(start, timeZone)
  const shiftedStart = wallTimeToDateInTimeZone(parts.year, parts.month + diff, 1, 0, 0, 0, timeZone)
  const shiftedParts = getPartsFromDateInTimeZone(shiftedStart, timeZone)
  const nextMonthStart = wallTimeToDateInTimeZone(
    shiftedParts.year,
    shiftedParts.month + 1,
    1,
    0,
    0,
    0,
    timeZone
  )

  return {
    start: shiftedStart,
    end: new Date(nextMonthStart.getTime() - 1),
  }
}

export function getMonthRangeFromValue(value: string | null | undefined, timeZone = PRAGUE_TZ) {
  const normalized = (value ?? '').trim()
  const isValid = /^\d{4}-\d{2}$/.test(normalized)
  const effectiveValue = isValid ? normalized : getCurrentMonthValuePrague(timeZone)
  const [yearRaw, monthRaw] = effectiveValue.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = wallTimeToDateInTimeZone(year, month, 1, 0, 0, 0, timeZone)
  const nextMonthStart = wallTimeToDateInTimeZone(year, month + 1, 1, 0, 0, 0, timeZone)
  const end = new Date(nextMonthStart.getTime() - 1)
  const label = new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone,
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
