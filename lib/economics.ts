export type LaborCompleteness = 'complete' | 'provisional' | 'incomplete'

export type JobEconomicsSummary = {
  job_id: string
  company_id?: string | null
  quoted_revenue_total: number
  revenue_total: number
  labor_hours_total: number
  internal_labor_cost_total: number
  external_labor_cost_total: number
  labor_cost_total: number | null
  other_cost_total: number
  total_cost_total: number | null
  profit_total: number | null
  margin_percent: number | null
  currency: string
  labor_completeness: LaborCompleteness
  labor_cost_reasons: string[]
  missing_rate_hours: number
  unapproved_labor_hours: number
  legacy_unverified_labor_count: number
  unconverted_labor_costs: { currency: string; amount: string }[]
  provisional_labor_cost_total: number
  known_labor_cost_total: number
  known_cost_total: number
}

export function toEconomicsNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function roundEconomicsMoney(value: number) {
  return Math.round(value * 100) / 100
}

/** A saved canonical zero is still an amount; legacy aliases must not revive old revenue. */
export function getInvoiceNetAmount(row: {
  subtotal_without_vat?: number | string | null
  total_without_vat?: number | string | null
  total_price?: number | string | null
  total_amount?: number | string | null
  total_with_vat?: number | string | null
}) {
  for (const amount of [row.subtotal_without_vat, row.total_without_vat, row.total_price, row.total_amount, row.total_with_vat]) {
    if (amount !== null && amount !== undefined && amount !== '') return toEconomicsNumber(amount)
  }
  return 0
}

export function getDirectCostTotal(item: {
  total_price?: number | string | null
  quantity?: number | string | null
  unit_price?: number | string | null
}) {
  const explicitTotal = toEconomicsNumber(item.total_price)
  if (explicitTotal > 0) return explicitTotal

  return toEconomicsNumber(item.quantity) * toEconomicsNumber(item.unit_price)
}

export function calculateQuotedJobEconomics(input: {
  quotedRevenue: number | string | null | undefined
  laborCost: number | string | null | undefined
  otherCost: number | string | null | undefined
  completeness?: LaborCompleteness
}) {
  const quotedRevenue = roundEconomicsMoney(toEconomicsNumber(input.quotedRevenue))
  const laborCost = roundEconomicsMoney(toEconomicsNumber(input.laborCost))
  const otherCost = roundEconomicsMoney(toEconomicsNumber(input.otherCost))
  const complete = (input.completeness ?? 'complete') === 'complete'
    && input.laborCost != null && input.otherCost != null
  const knownTotalCost = roundEconomicsMoney(laborCost + otherCost)
  const totalCost = complete ? knownTotalCost : null
  const profit = totalCost === null ? null : roundEconomicsMoney(quotedRevenue - totalCost)

  return {
    quotedRevenue,
    laborCost,
    otherCost,
    totalCost,
    profit,
    knownTotalCost,
    margin_percent: profit !== null && quotedRevenue > 0 ? roundEconomicsMoney((profit / quotedRevenue) * 100) : null,
  }
}

export function buildJobEconomicsSummary(input: {
  jobId: string
  companyId?: string | null
  quotedRevenue: number
  invoicedRevenue: number
  laborHours: number
  internalLaborCost: number
  externalLaborCost: number
  directCost: number
  currency?: string
  laborCompleteness?: LaborCompleteness
  laborCostReasons?: string[]
  missingRateHours?: number
  unapprovedLaborHours?: number
  legacyUnverifiedLaborCount?: number
  unconvertedLaborCosts?: { currency: string; amount: string }[]
  provisionalLaborCost?: number
}): JobEconomicsSummary {
  const internalLaborCost = roundEconomicsMoney(input.internalLaborCost)
  const externalLaborCost = roundEconomicsMoney(input.externalLaborCost)
  const laborCost = roundEconomicsMoney(internalLaborCost + externalLaborCost)
  const directCost = roundEconomicsMoney(input.directCost)
  const knownCost = roundEconomicsMoney(laborCost + directCost)
  const completeness = input.laborCompleteness ?? 'complete'
  const complete = completeness === 'complete' && (input.unconvertedLaborCosts?.length ?? 0) === 0
  const totalCost = complete ? knownCost : null
  const quotedRevenue = roundEconomicsMoney(input.quotedRevenue)
  const invoicedRevenue = roundEconomicsMoney(input.invoicedRevenue)
  const profit = totalCost === null ? null : roundEconomicsMoney(invoicedRevenue - totalCost)

  return {
    job_id: input.jobId,
    company_id: input.companyId ?? null,
    quoted_revenue_total: quotedRevenue,
    revenue_total: invoicedRevenue,
    labor_hours_total: roundEconomicsMoney(input.laborHours),
    internal_labor_cost_total: internalLaborCost,
    external_labor_cost_total: externalLaborCost,
    labor_cost_total: complete ? laborCost : null,
    other_cost_total: directCost,
    total_cost_total: totalCost,
    profit_total: profit,
    currency: input.currency ?? 'CZK',
    labor_completeness: complete ? 'complete' : completeness === 'complete' ? 'incomplete' : completeness,
    labor_cost_reasons: input.laborCostReasons ?? [],
    missing_rate_hours: input.missingRateHours ?? 0,
    unapproved_labor_hours: input.unapprovedLaborHours ?? 0,
    legacy_unverified_labor_count: input.legacyUnverifiedLaborCount ?? 0,
    unconverted_labor_costs: input.unconvertedLaborCosts ?? [],
    provisional_labor_cost_total: input.provisionalLaborCost ?? 0,
    known_labor_cost_total: laborCost,
    known_cost_total: knownCost,
    margin_percent: profit !== null && invoicedRevenue > 0 ? roundEconomicsMoney((profit / invoicedRevenue) * 100) : null,
  }
}

/** An unknown component (or a different currency) must never become zero in a KPI. */
export function sumCompleteJobProfit(rows: JobEconomicsSummary[], currency: string): number | null {
  if (rows.some(row => row.labor_completeness !== 'complete' || row.profit_total === null || row.currency !== currency)) return null
  return roundEconomicsMoney(rows.reduce((sum, row) => sum + row.profit_total!, 0))
}

/** Null on an existing row is unresolved/mixed currency, never a default currency. */
export function commonEconomicsCurrency(rows: readonly { currency: string | null | undefined }[], emptyCurrency = 'CZK'): string | null {
  if (rows.length === 0) return emptyCurrency
  const currency = rows[0].currency
  return currency && rows.every(row => row.currency === currency) ? currency : null
}
