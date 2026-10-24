import { type FixedCostRow } from './costs'

export function financialCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}
function cents(value: unknown): bigint | null {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof raw !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(raw) || raw.length > 30) return null
  const [whole, fraction = ''] = raw.split('.')
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null
}
/** Null means unavailable, invalid or incomparable; a proved empty set is zero. */
export function sumCostsInCurrency(rows: readonly { amount: unknown; currency: unknown }[] | null, target: string | null): number | null {
  const currency = financialCurrency(target)
  if (!rows || !currency) return null
  let total = BigInt(0)
  for (const row of rows) {
    const amount = cents(row.amount)
    if (amount === null || financialCurrency(row.currency) !== currency) return null
    total += amount
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null
  }
  return Number(total) / 100
}
function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function sumFixedCostsInMonth(rows: readonly FixedCostRow[] | null, start: string, end: string, currency: string | null): number | null {
  if (!rows || !validDate(start) || !validDate(end) || start >= end) return null
  const included: FixedCostRow[] = []
  for (const row of rows) {
    if (row.is_active === false) continue
    if (row.is_active !== true || !validDate(row.start_date) || (row.end_date !== null && !validDate(row.end_date))) return null
    if (row.end_date !== null && row.end_date < row.start_date) return null
    if (row.start_date >= end || (row.end_date !== null && row.end_date < start)) continue
    if (row.recurrence === 'one_time') {
      if (row.start_date >= start) included.push(row)
    } else if (row.recurrence === 'monthly') {
      included.push(row)
    } else {
      // Weekly/yearly allocation is not implemented; it must never appear as zero.
      return null
    }
  }
  return sumCostsInCurrency(included, currency)
}
export function combineKnownCosts(...values: (number | null)[]): number | null {
  if (values.some(value => value === null || !Number.isFinite(value))) return null
  const total = (values as number[]).reduce((sum, value) => sum + Math.round(value * 100), 0)
  return Number.isSafeInteger(total) ? total / 100 : null
}
