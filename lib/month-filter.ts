const monthPattern = /^\d{4}-\d{2}$/

function padMonth(value: number) {
  return String(value).padStart(2, '0')
}

export function formatMonthValue(date = new Date()) {
  return `${date.getFullYear()}-${padMonth(date.getMonth() + 1)}`
}

export function resolveMonthValue(value: string | undefined) {
  if (value && monthPattern.test(value)) return value
  return formatMonthValue()
}

export function getMonthDateRange(month: string) {
  const [yearValue, monthValue] = month.split('-').map(Number)
  const lastDay = new Date(yearValue, monthValue, 0).getDate()

  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function shiftMonthValue(month: string, offset: number) {
  const [yearValue, monthValue] = month.split('-').map(Number)
  return formatMonthValue(new Date(yearValue, monthValue - 1 + offset, 1))
}

export function formatMonthLabel(month: string, locale = 'cs-CZ') {
  const [yearValue, monthValue] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(yearValue, monthValue - 1, 1))
}
