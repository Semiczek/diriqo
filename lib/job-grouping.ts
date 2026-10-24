export type JobParentLinkRow = {
  id: string
  parent_job_id: string | null
}

export function getJobGroupRootId(
  jobId: string,
  parentByJobId: Map<string, string | null>,
  knownJobIds?: Set<string>
) {
  const parentJobId = parentByJobId.get(jobId) ?? null

  if (!parentJobId) return jobId
  if (knownJobIds && !knownJobIds.has(parentJobId)) return jobId

  return parentJobId
}

export function buildJobGroups<T extends JobParentLinkRow>(jobs: T[]) {
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const knownJobIds = new Set(jobsById.keys())
  const parentByJobId = new Map(jobs.map((job) => [job.id, job.parent_job_id ?? null]))
  const groups = new Map<string, T[]>()

  for (const job of jobs) {
    const rootId = getJobGroupRootId(job.id, parentByJobId, knownJobIds)
    const current = groups.get(rootId) ?? []
    current.push(job)
    groups.set(rootId, current)
  }

  return {
    jobsById,
    parentByJobId,
    groups,
  }
}


import { roundEconomicsMoney, type JobEconomicsSummary } from '@/lib/economics'

/** Missing rows and mixed currencies cannot be represented as a single financial total. */
export function aggregateJobEconomics(
  rows: JobEconomicsSummary[], expectedJobIds: string[], currency: string
): JobEconomicsSummary | null {
  const ids = new Set(expectedJobIds)
  if (!ids.size || rows.length !== ids.size || new Set(rows.map(row => row.job_id)).size !== ids.size
    || rows.some(row => !ids.has(row.job_id) || row.currency !== currency || row.company_id !== rows[0].company_id)) return null
  const sum = (read: (row: JobEconomicsSummary) => number) => roundEconomicsMoney(rows.reduce((total, row) => total + read(row), 0))
  const completeness = rows.some(row => row.labor_completeness === 'incomplete') ? 'incomplete'
    : rows.some(row => row.labor_completeness === 'provisional') ? 'provisional' : 'complete'
  const complete = completeness === 'complete' && rows.every(row => row.total_cost_total !== null && row.labor_cost_total !== null && row.profit_total !== null)
  const revenue = sum(row => row.revenue_total), totalCost = complete ? sum(row => row.total_cost_total!) : null
  const profit = totalCost === null ? null : roundEconomicsMoney(revenue - totalCost)
  return {
    job_id: rows[0].job_id, company_id: rows[0].company_id, currency,
    quoted_revenue_total: sum(row => row.quoted_revenue_total), revenue_total: revenue,
    labor_hours_total: sum(row => row.labor_hours_total),
    internal_labor_cost_total: sum(row => row.internal_labor_cost_total),
    external_labor_cost_total: sum(row => row.external_labor_cost_total),
    labor_cost_total: complete ? sum(row => row.labor_cost_total!) : null,
    other_cost_total: sum(row => row.other_cost_total), total_cost_total: totalCost, profit_total: profit,
    margin_percent: profit !== null && revenue > 0 ? roundEconomicsMoney(profit / revenue * 100) : null,
    labor_completeness: complete ? 'complete' : completeness === 'complete' ? 'incomplete' : completeness,
    labor_cost_reasons: [...new Set(rows.flatMap(row => row.labor_cost_reasons))],
    missing_rate_hours: sum(row => row.missing_rate_hours), unapproved_labor_hours: sum(row => row.unapproved_labor_hours),
    legacy_unverified_labor_count: sum(row => row.legacy_unverified_labor_count),
    unconverted_labor_costs: rows.flatMap(row => row.unconverted_labor_costs),
    provisional_labor_cost_total: sum(row => row.provisional_labor_cost_total),
    known_labor_cost_total: sum(row => row.known_labor_cost_total), known_cost_total: sum(row => row.known_cost_total),
  }
}
