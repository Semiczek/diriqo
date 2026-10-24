import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import {
  buildJobEconomicsSummary,
  getDirectCostTotal,
  getInvoiceNetAmount,
  toEconomicsNumber,
  type JobEconomicsSummary,
} from '@/lib/economics'
import { getJobLaborCostTotals } from '@/lib/dal/labor-history'
import { DalAuthError } from '@/lib/dal/auth'
import { readCompleteEconomicsRows, ECONOMICS_PAGE_SIZE } from '@/lib/dal/economics-pages'
import type { JobLaborCostTotalsDto } from '@/lib/labor-history'

type JobRow = { id: string; company_id: string | null; price?: number | string | null; currency?: string | null }

type CostItemRow = {
  id: string
  job_id: string | null
  total_price?: number | string | null
  quantity?: number | string | null
  unit_price?: number | string | null
}

type InvoiceItemRow = {
  id: string
  source_job_id?: string | null
  total_without_vat?: number | string | null
  total_price?: number | string | null
  total_with_vat?: number | string | null
  invoices?: { status?: string | null; currency?: string | null } | { status?: string | null; currency?: string | null }[] | null
}

type InvoiceRow = {
  id: string
  job_id?: string | null
  status?: string | null
  currency?: string | null
  subtotal_without_vat?: number | string | null
  total_without_vat?: number | string | null
  total_amount?: number | string | null
  total_with_vat?: number | string | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function addToMap(map: Map<string, number>, key: string | null | undefined, value: number) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + value)
}

function isRevenueInvoiceStatus(status: string | null | undefined) {
  const normalized = (status ?? '').trim().toLowerCase()
  return ['issued', 'sent', 'paid', 'overdue'].includes(normalized)
}

function isMissingSourceJobColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return (error?.code === '42703' || error?.code === 'PGRST204') && message.includes('source_job_id')
}

export async function listJobEconomicsSummaries(
  ctx: DalContext,
  jobIds: string[],
): Promise<JobEconomicsSummary[]> {
  if (!['company_admin', 'super_admin'].includes(ctx.role ?? '')) throw new DalAuthError()
  const uniqueJobIds = Array.from(new Set(jobIds.filter(Boolean)))
  if (uniqueJobIds.length === 0) return []

  // Bound every RPC and table read. Keep failures explicit instead of returning partial totals.
  const summaries: JobEconomicsSummary[] = []
  for (let offset = 0; offset < uniqueJobIds.length; offset += 500) {
    summaries.push(...await readEconomicsBatch(ctx, uniqueJobIds.slice(offset, offset + 500)))
  }
  return summaries
}

async function readEconomicsBatch(ctx: DalContext, jobIds: string[]): Promise<JobEconomicsSummary[]> {
  const { data: jobsData, error: jobsError } = await ctx.supabase
    .from('jobs').select('id, company_id, price, currency')
    .eq('company_id', ctx.companyId).in('id', jobIds)
  if (jobsError) throw jobsError
  const jobs = ((jobsData ?? []) as JobRow[]).filter(job => job.company_id === ctx.companyId)
  if (jobs.length !== jobIds.length || new Set(jobs.map(job => job.id)).size !== jobIds.length) {
    throw new DalAuthError('Ekonomika vybraných zakázek není dostupná v této firmě.')
  }
  const jobCurrencies = new Map(jobs.map(job => {
    if (typeof job.currency !== 'string' || !/^[A-Z]{3}$/.test(job.currency)) {
      throw new Error('Chybí platná měna zakázky. Ekonomiku nelze spočítat.')
    }
    return [job.id, job.currency] as const
  }))
  const [labor, costItems, moduleCosts, revenue] = await Promise.all([
    getJobLaborCostTotals(ctx, jobIds),
    readCompleteEconomicsRows<CostItemRow>(offset => ctx.supabase.from('job_cost_items').select('id, job_id, total_price, quantity, unit_price', { count: 'exact' })
      .eq('company_id', ctx.companyId).in('job_id', jobIds).order('id').range(offset, offset + ECONOMICS_PAGE_SIZE - 1)),
    ctx.supabase.rpc('job_module_cost_totals', { company: ctx.companyId, job_ids: jobIds }),
    getInvoiceRevenueByJobId(ctx, jobCurrencies),
  ])
  if (moduleCosts.error) throw moduleCosts.error
  const laborByJob = new Map(labor.items.map(item => [item.jobId, item]))
  const directCosts = new Map<string, number>()
  for (const item of costItems) {
    addToMap(directCosts, item.job_id, getDirectCostTotal(item))
  }
  for (const item of (moduleCosts.data ?? []) as { job_id: string; total_amount: number | string }[]) {
    addToMap(directCosts, item.job_id, toEconomicsNumber(item.total_amount))
  }
  return jobs.map(job => {
    const item = laborByJob.get(job.id)
    if (!item) throw new Error('Chybí ověřený souhrn práce pro zakázku.')
    if (item.currency !== jobCurrencies.get(job.id)) throw new Error('Měna zakázky se během načítání změnila. Obnovte přehled.')
    return buildJobEconomicsSummary({
      jobId: job.id, companyId: ctx.companyId, currency: item.currency,
      quotedRevenue: toEconomicsNumber(job.price), invoicedRevenue: revenue.get(job.id) ?? 0,
      laborHours: exactDisplayNumber(item.approvedHours),
      internalLaborCost: exactDisplayNumber(item.approvedInternalCost),
      externalLaborCost: exactDisplayNumber(item.approvedExternalCost),
      directCost: directCosts.get(job.id) ?? 0,
      laborCompleteness: item.completeness, laborCostReasons: item.reasons,
      missingRateHours: exactDisplayNumber(item.missingRateHours),
      unapprovedLaborHours: exactDisplayNumber(item.unapprovedHours),
      legacyUnverifiedLaborCount: item.legacyUnverifiedCount,
      unconvertedLaborCosts: item.unconvertedCosts,
      provisionalLaborCost: exactDisplayNumber(item.provisionalKnownCost),
    })
  })
}

/** Database money remains decimal; reject overflow when adapting existing numeric UI. */
function exactDisplayNumber(value: JobLaborCostTotalsDto['items'][number]['approvedCost']): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error('Částka je mimo bezpečný rozsah zobrazení.')
  }
  return parsed
}

async function getInvoiceRevenueByJobId(
  ctx: Pick<DalContext, 'supabase' | 'companyId'>,
  jobCurrencies: Map<string, string>,
) {
  const jobIds = [...jobCurrencies.keys()]
  const revenueByJobId = new Map<string, number>()

  try {
    const items = await readCompleteEconomicsRows<InvoiceItemRow>(offset => ctx.supabase
      .from('invoice_items')
      .select('id, source_job_id, total_without_vat, total_price, total_with_vat, invoices!inner(status, company_id, currency)', { count: 'exact' })
      .eq('invoices.company_id', ctx.companyId).in('source_job_id', jobIds)
      .order('id').range(offset, offset + ECONOMICS_PAGE_SIZE - 1))
    for (const item of items) {
      const invoice = asSingle(item.invoices)
      if (!isRevenueInvoiceStatus(invoice?.status)) continue
      assertInvoiceCurrency(jobCurrencies, item.source_job_id, invoice?.currency)
      addToMap(revenueByJobId, item.source_job_id, getInvoiceNetAmount(item))
    }
    return revenueByJobId
  } catch (error) {
    if (!isMissingSourceJobColumn(error as { code?: string; message?: string })) throw error
  }
  const invoices = await readCompleteEconomicsRows<InvoiceRow>(offset => ctx.supabase.from('invoices')
    .select('id, job_id, status, currency, subtotal_without_vat, total_without_vat, total_amount, total_with_vat', { count: 'exact' })
    .eq('company_id', ctx.companyId).in('job_id', jobIds).order('id').range(offset, offset + ECONOMICS_PAGE_SIZE - 1))
  for (const invoice of invoices) {
    if (!isRevenueInvoiceStatus(invoice.status)) continue
    assertInvoiceCurrency(jobCurrencies, invoice.job_id, invoice.currency)
    addToMap(revenueByJobId, invoice.job_id, getInvoiceNetAmount(invoice))
  }
  return revenueByJobId
}

function assertInvoiceCurrency(jobCurrencies: Map<string, string>, jobId: string | null | undefined, invoiceCurrency: string | null | undefined) {
  const jobCurrency = jobId ? jobCurrencies.get(jobId) : undefined
  if (!jobCurrency || invoiceCurrency !== jobCurrency) {
    throw new Error('Měna vydané faktury chybí nebo neodpovídá měně zakázky. Výnos nelze spočítat.')
  }
}
