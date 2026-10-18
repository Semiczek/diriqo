/** A payment day is a schedule, never a payroll period boundary. */
export function parsePayday(value: unknown): number | null {
  if (value == null || value === '') return null
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,2}$/.test(String(value))) {
    throw new Error('Výplatní den musí být celé číslo od 1 do 31, nebo zůstat nenastavený.')
  }
  const day = Number(value)
  if (day < 1 || day > 31) throw new Error('Výplatní den musí být od 1 do 31.')
  return day
}

export function payrollMonthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Neplatný mzdový měsíc.')
  const [year, number] = month.split('-').map(Number)
  if (year < 1000 || year > 9998) throw new Error('Neplatný mzdový rok.')
  const next = new Date(Date.UTC(year, number, 1))
  return { startDate: `${month}-01`, endExclusiveDate: next.toISOString().slice(0, 10) }
}

/** Work in M is planned for day d in M+1, clipped at that month's end. */
export function plannedPayday(month: string, value: unknown): string | null {
  const day = parsePayday(value)
  const range = payrollMonthRange(month)
  if (day == null) return null
  const next = new Date(`${range.endExclusiveDate}T00:00:00Z`)
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next.toISOString().slice(0, 10)
}
