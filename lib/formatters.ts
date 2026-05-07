import { parseDateSafe, PRAGUE_TZ } from '@/lib/date/prague-time'

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '\u2014'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatSignedCurrency(value: number): string {
  if (value > 0) return `+${formatCurrency(value)}`
  if (value < 0) return `-${formatCurrency(Math.abs(value))}`
  return formatCurrency(0)
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'

  return `${Math.round(value)} %`
}

export function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '\u2014'
  return `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} h`
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = parseDateSafe(value)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: PRAGUE_TZ,
  }).format(date)
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = parseDateSafe(value)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TZ,
  }).format(date)
}

export function formatDateTimePrague(value: string | Date | null | undefined, locale = 'cs-CZ'): string {
  const date = parseDateSafe(value)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TZ,
  }).format(date)
}
