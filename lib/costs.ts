export const fixedCostCategories = [
  'Nájem',
  'Elektřina',
  'Plyn',
  'Voda',
  'Internet',
  'Telefon',
  'Leasing',
  'Software',
  'Pojištění',
  'Účetní',
  'Úvěr',
  'Marketing',
  'Ostatní',
] as const

export const jobExpenseCategories = [
  'Materiál',
  'Doprava',
  'Mzdy pracovníků',
  'Externisti',
  'Pronájem techniky',
  'Ubytování',
  'Parkovné / mýto',
  'Ostatní',
] as const

export const oneTimeExpenseCategories = [
  'Vybavení',
  'Servis',
  'Auto',
  'Opravy',
  'Marketing',
  'Ostatní',
] as const

export const recurrenceOptions = [
  { key: 'monthly', label: 'Měsíčně' },
  { key: 'one_time', label: 'Jednorázově' },
  { key: 'weekly', label: 'Týdně' },
  { key: 'yearly', label: 'Ročně' },
] as const

export const expenseSources = ['manual', 'shift', 'assignment', 'import'] as const

export type FixedCostCategory = (typeof fixedCostCategories)[number]
export type JobExpenseCategory = (typeof jobExpenseCategories)[number]
export type OneTimeExpenseCategory = (typeof oneTimeExpenseCategories)[number]
export type CostRecurrence = (typeof recurrenceOptions)[number]['key']
export type ExpenseSource = (typeof expenseSources)[number]

export type FixedCostRow = {
  id: string
  company_id: string
  name: string
  category: string
  amount: number | string
  currency: string | null
  due_day: number | null
  recurrence: CostRecurrence | string | null
  start_date: string | null
  end_date: string | null
  is_active: boolean | null
  note: string | null
  created_at: string | null
  updated_at: string | null
}

export type ExpenseRow = {
  id: string
  company_id: string
  job_id: string | null
  worker_id: string | null
  name: string
  category: string
  amount: number | string
  currency: string | null
  expense_date: string | null
  source: ExpenseSource | string | null
  note: string | null
  created_at: string | null
  updated_at: string | null
}

export function toCostNumber(value: number | string | null | undefined) {
  if (value == null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeCurrency(value: string | null | undefined, fallback = 'CZK') {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return fallback
  return normalized.slice(0, 12)
}

export function normalizeRecurrence(value: string | null | undefined): CostRecurrence {
  const normalized = (value ?? '').trim().toLowerCase()
  return recurrenceOptions.some((option) => option.key === normalized)
    ? (normalized as CostRecurrence)
    : 'monthly'
}

export function getRecurrenceLabel(value: string | null | undefined) {
  const recurrence = normalizeRecurrence(value)
  return recurrenceOptions.find((option) => option.key === recurrence)?.label ?? recurrence
}

export function formatCostCurrency(value: number, currency = 'CZK', locale = 'cs-CZ') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalizeCurrency(currency),
    maximumFractionDigits: 0,
  }).format(value)
}

export function isDateInRange(dateValue: string | null | undefined, startDate: string, endDate: string) {
  if (!dateValue) return false
  return dateValue >= startDate && dateValue < endDate
}

export function isFixedCostActiveInMonth(cost: FixedCostRow, monthStart: string, nextMonthStart: string) {
  if (cost.is_active === false) return false
  const startDate = cost.start_date ?? monthStart
  const endDate = cost.end_date

  return startDate < nextMonthStart && (!endDate || endDate >= monthStart)
}

export function getFixedCostMonthlyAmount(cost: FixedCostRow, monthStart: string, nextMonthStart: string) {
  const recurrence = normalizeRecurrence(cost.recurrence)
  const amount = toCostNumber(cost.amount)

  if (recurrence === 'one_time') {
    return isDateInRange(cost.start_date, monthStart, nextMonthStart) ? amount : 0
  }

  if (recurrence === 'monthly' && isFixedCostActiveInMonth(cost, monthStart, nextMonthStart)) {
    return amount
  }

  return 0
}

export function isOneTimeExpense(expense: Pick<ExpenseRow, 'job_id' | 'category'>) {
  return !expense.job_id || oneTimeExpenseCategories.includes(expense.category as OneTimeExpenseCategory)
}
