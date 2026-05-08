export type JobEconomicsSummary = {
  job_id: string
  company_id?: string | null
  quoted_revenue_total: number
  revenue_total: number
  labor_hours_total: number
  internal_labor_cost_total: number
  external_labor_cost_total: number
  labor_cost_total: number
  other_cost_total: number
  total_cost_total: number
  profit_total: number
  margin_percent: number | null
}

export function toEconomicsNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function roundEconomicsMoney(value: number) {
  return Math.round(value * 100) / 100
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
}) {
  const quotedRevenue = roundEconomicsMoney(toEconomicsNumber(input.quotedRevenue))
  const laborCost = roundEconomicsMoney(toEconomicsNumber(input.laborCost))
  const otherCost = roundEconomicsMoney(toEconomicsNumber(input.otherCost))
  const totalCost = roundEconomicsMoney(laborCost + otherCost)
  const profit = roundEconomicsMoney(quotedRevenue - totalCost)

  return {
    quotedRevenue,
    laborCost,
    otherCost,
    totalCost,
    profit,
    margin_percent: quotedRevenue > 0 ? roundEconomicsMoney((profit / quotedRevenue) * 100) : null,
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
}): JobEconomicsSummary {
  const internalLaborCost = roundEconomicsMoney(input.internalLaborCost)
  const externalLaborCost = roundEconomicsMoney(input.externalLaborCost)
  const laborCost = roundEconomicsMoney(internalLaborCost + externalLaborCost)
  const directCost = roundEconomicsMoney(input.directCost)
  const totalCost = roundEconomicsMoney(laborCost + directCost)
  const quotedRevenue = roundEconomicsMoney(input.quotedRevenue)
  const invoicedRevenue = roundEconomicsMoney(input.invoicedRevenue)
  const profit = roundEconomicsMoney(invoicedRevenue - totalCost)

  return {
    job_id: input.jobId,
    company_id: input.companyId ?? null,
    quoted_revenue_total: quotedRevenue,
    revenue_total: invoicedRevenue,
    labor_hours_total: roundEconomicsMoney(input.laborHours),
    internal_labor_cost_total: internalLaborCost,
    external_labor_cost_total: externalLaborCost,
    labor_cost_total: laborCost,
    other_cost_total: directCost,
    total_cost_total: totalCost,
    profit_total: profit,
    margin_percent: invoicedRevenue > 0 ? roundEconomicsMoney((profit / invoicedRevenue) * 100) : null,
  }
}
