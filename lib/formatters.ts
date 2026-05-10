import { parseDateSafe, PRAGUE_TZ } from '@/lib/date/prague-time'

export function formatCurrency(value: number | null | undefined, locale = 'cs-CZ'): string {
  if (value == null) return '\u2014'

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatSignedCurrency(value: number, locale = 'cs-CZ'): string {
  if (value > 0) return `+${formatCurrency(value, locale)}`
  if (value < 0) return `-${formatCurrency(Math.abs(value), locale)}`
  return formatCurrency(0, locale)
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'

  return `${Math.round(value)} %`
}

export function formatHours(value: number | null | undefined, locale = 'cs-CZ'): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} h`
}

export function formatDate(value: string | Date | null | undefined, timeZone = PRAGUE_TZ, locale = 'cs-CZ'): string {
  const date = parseDateSafe(value, timeZone)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(date)
}

export function formatTime(value: string | Date | null | undefined, timeZone = PRAGUE_TZ, locale = 'cs-CZ'): string {
  const date = parseDateSafe(value, timeZone)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

export function formatDateTimePrague(value: string | Date | null | undefined, locale = 'cs-CZ', timeZone = PRAGUE_TZ): string {
  const date = parseDateSafe(value, timeZone)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}
