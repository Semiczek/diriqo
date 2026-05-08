import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import {
  buildJobEconomicsSummary,
  getDirectCostTotal,
  toEconomicsNumber,
  type JobEconomicsSummary,
} from '@/lib/economics'
import {
  getAssignmentFallbackLaborCalculation,
  getHoursFromRange,
  getShiftLaborCalculation,
  roundLaborHours,
} from '@/lib/labor-calculation'
import { getContractorBillingType, getWorkerType } from '@/lib/payroll-settings'

type ProfileRelation = {
  id?: string | null
  default_hourly_rate?: number | string | null
  hourly_rate?: number | string | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | string | null
}

type JobRow = {
  id: string
  company_id: string | null
  price?: number | string | null
}

type WorkShiftRow = {
  id: string
  job_id: string | null
  profile_id: string | null
  started_at: string | null
  ended_at: string | null
  hours_override?: number | string | null
  job_hours_override?: number | string | null
  hourly_rate?: number | string | null
  profiles?: ProfileRelation | ProfileRelation[] | null
}

type WorkLogRow = {
  id: string
  job_id: string | null
  profile_id: string | null
  hours?: number | string | null
  started_at?: string | null
  ended_at?: string | null
  profiles?: ProfileRelation | ProfileRelation[] | null
}

type AssignmentRow = {
  id: string
  job_id: string | null
  profile_id: string | null
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | string | null
  work_started_at?: string | null
  work_completed_at?: string | null
  profiles?: ProfileRelation | ProfileRelation[] | null
}

type CostItemRow = {
  job_id: string | null
  total_price?: number | string | null
  quantity?: number | string | null
  unit_price?: number | string | null
}

type InvoiceItemRow = {
  source_job_id?: string | null
  total_without_vat?: number | string | null
  total_price?: number | string | null
  total_with_vat?: number | string | null
  invoices?: { status?: string | null } | { status?: string | null }[] | null
}

type InvoiceRow = {
  job_id?: string | null
  status?: string | null
  total_without_vat?: number | string | null
  total_amount?: number | string | null
  total_with_vat?: number | string | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function getProfileHourlyRate(profile: ProfileRelation | null, fallback?: number | string | null) {
  return toEconomicsNumber(
    fallback ?? profile?.contractor_default_rate ?? profile?.default_hourly_rate ?? profile?.hourly_rate
  )
}

function addToMap(map: Map<string, number>, key: string | null | undefined, value: number) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + value)
}

function getInvoiceNetAmount(row: InvoiceItemRow | InvoiceRow) {
  const totalWithoutVat = toEconomicsNumber(row.total_without_vat)
  if (totalWithoutVat > 0) return totalWithoutVat

  const totalPrice = 'total_price' in row ? toEconomicsNumber(row.total_price) : 0
  if (totalPrice > 0) return totalPrice

  const totalAmount = 'total_amount' in row ? toEconomicsNumber(row.total_amount) : 0
  if (totalAmount > 0) return totalAmount

  return toEconomicsNumber(row.total_with_vat)
}

function isRevenueInvoiceStatus(status: string | null | undefined) {
  const normalized = (status ?? '').trim().toLowerCase()
  return normalized !== 'cancelled' && normalized !== 'canceled' && normalized !== 'void'
}

function isMissingSourceJobColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('source_job_id')
}

export async function listJobEconomicsSummaries(
  ctx: Pick<DalContext, 'supabase' | 'companyId'>,
  jobIds: string[],
): Promise<JobEconomicsSummary[]> {
  const uniqueJobIds = Array.from(new Set(jobIds.filter(Boolean)))
  if (uniqueJobIds.length === 0) return []

  const { data: jobsData, error: jobsError } = await ctx.supabase
    .from('jobs')
    .select('id, company_id, price')
    .eq('company_id', ctx.companyId)
    .in('id', uniqueJobIds)

  if (jobsError) throw jobsError

  const jobs = ((jobsData ?? []) as JobRow[]).filter((job) => job.company_id === ctx.companyId)
  const scopedJobIds = jobs.map((job) => job.id)
  if (scopedJobIds.length === 0) return []

  const [shiftsResponse, logsResponse, assignmentsResponse, costItemsResponse] = await Promise.all([
    ctx.supabase
      .from('work_shifts')
      .select(
        `
          id,
          job_id,
          profile_id,
          started_at,
          ended_at,
          hours_override,
          job_hours_override,
          hourly_rate,
          profiles (
            id,
            default_hourly_rate,
            hourly_rate,
            worker_type,
            contractor_billing_type,
            contractor_default_rate
          )
        `,
      )
      .eq('company_id', ctx.companyId)
      .in('job_id', scopedJobIds),
    ctx.supabase
      .from('work_logs')
      .select(
        `
          id,
          job_id,
          profile_id,
          hours,
          started_at,
          ended_at,
          profiles (
            id,
            default_hourly_rate,
            hourly_rate,
            worker_type,
            contractor_billing_type,
            contractor_default_rate
          )
        `,
      )
      .eq('company_id', ctx.companyId)
      .in('job_id', scopedJobIds)
      .is('archived_at', null),
    ctx.supabase
      .from('job_assignments')
      .select(
        `
          id,
          job_id,
          profile_id,
          labor_hours,
          hourly_rate,
          worker_type_snapshot,
          assignment_billing_type,
          external_amount,
          work_started_at,
          work_completed_at,
          profiles (
            id,
            default_hourly_rate,
            hourly_rate,
            worker_type,
            contractor_billing_type,
            contractor_default_rate
          )
        `,
      )
      .in('job_id', scopedJobIds)
      .is('archived_at', null),
    ctx.supabase
      .from('job_cost_items')
      .select('job_id, total_price, quantity, unit_price')
      .eq('company_id', ctx.companyId)
      .in('job_id', scopedJobIds),
  ])

  if (shiftsResponse.error) throw shiftsResponse.error
  if (logsResponse.error) throw logsResponse.error
  if (assignmentsResponse.error) throw assignmentsResponse.error
  if (costItemsResponse.error) throw costItemsResponse.error

  const laborHoursByJobId = new Map<string, number>()
  const internalLaborByJobId = new Map<string, number>()
  const externalLaborByJobId = new Map<string, number>()
  const directCostByJobId = new Map<string, number>()
  const coveredWorkerKeys = new Set<string>()

  for (const shift of (shiftsResponse.data ?? []) as WorkShiftRow[]) {
    if (!shift.job_id) continue

    const profile = asSingle(shift.profiles)
    const calculation = getShiftLaborCalculation(shift, getProfileHourlyRate(profile, shift.hourly_rate))
    const workerType = getWorkerType(profile)
    addToMap(laborHoursByJobId, shift.job_id, calculation.hours)
    addToMap(
      workerType === 'contractor' ? externalLaborByJobId : internalLaborByJobId,
      shift.job_id,
      calculation.reward,
    )

    if (shift.profile_id) coveredWorkerKeys.add(`${shift.job_id}:${shift.profile_id}`)
  }

  for (const log of (logsResponse.data ?? []) as WorkLogRow[]) {
    if (!log.job_id) continue
    if (log.profile_id && coveredWorkerKeys.has(`${log.job_id}:${log.profile_id}`)) continue

    const profile = asSingle(log.profiles)
    const hours =
      toEconomicsNumber(log.hours) > 0
        ? toEconomicsNumber(log.hours)
        : getHoursFromRange(log.started_at ?? null, log.ended_at ?? null)
    const reward = roundLaborHours(hours * getProfileHourlyRate(profile))
    const workerType = getWorkerType(profile)

    addToMap(laborHoursByJobId, log.job_id, hours)
    addToMap(workerType === 'contractor' ? externalLaborByJobId : internalLaborByJobId, log.job_id, reward)

    if (log.profile_id) coveredWorkerKeys.add(`${log.job_id}:${log.profile_id}`)
  }

  for (const assignment of (assignmentsResponse.data ?? []) as AssignmentRow[]) {
    if (!assignment.job_id) continue
    if (assignment.profile_id && coveredWorkerKeys.has(`${assignment.job_id}:${assignment.profile_id}`)) continue

    const profile = asSingle(assignment.profiles)
    const workerType = getWorkerType({
      worker_type: assignment.worker_type_snapshot ?? profile?.worker_type,
    })
    const billingType = getContractorBillingType(
      assignment.assignment_billing_type ?? profile?.contractor_billing_type,
    )
    const calculation = getAssignmentFallbackLaborCalculation(
      assignment,
      getProfileHourlyRate(profile, assignment.hourly_rate),
    )
    const contractorFixedCost =
      workerType === 'contractor' && billingType !== 'hourly' && assignment.external_amount != null
        ? toEconomicsNumber(assignment.external_amount)
        : calculation.reward

    addToMap(laborHoursByJobId, assignment.job_id, calculation.hours)
    addToMap(
      workerType === 'contractor' ? externalLaborByJobId : internalLaborByJobId,
      assignment.job_id,
      workerType === 'contractor' ? contractorFixedCost : calculation.reward,
    )
  }

  for (const item of (costItemsResponse.data ?? []) as CostItemRow[]) {
    addToMap(directCostByJobId, item.job_id, getDirectCostTotal(item))
  }

  const revenueByJobId = await getInvoiceRevenueByJobId(ctx, scopedJobIds)

  return jobs.map((job) =>
    buildJobEconomicsSummary({
      jobId: job.id,
      companyId: job.company_id,
      quotedRevenue: toEconomicsNumber(job.price),
      invoicedRevenue: revenueByJobId.get(job.id) ?? 0,
      laborHours: laborHoursByJobId.get(job.id) ?? 0,
      internalLaborCost: internalLaborByJobId.get(job.id) ?? 0,
      externalLaborCost: externalLaborByJobId.get(job.id) ?? 0,
      directCost: directCostByJobId.get(job.id) ?? 0,
    }),
  )
}

async function getInvoiceRevenueByJobId(
  ctx: Pick<DalContext, 'supabase' | 'companyId'>,
  jobIds: string[],
) {
  const revenueByJobId = new Map<string, number>()

  const itemsResponse = await ctx.supabase
    .from('invoice_items')
    .select(
      `
        source_job_id,
        total_without_vat,
        total_price,
        total_with_vat,
        invoices!inner (
          status,
          company_id
        )
      `,
    )
    .eq('invoices.company_id', ctx.companyId)
    .in('source_job_id', jobIds)

  if (!itemsResponse.error) {
    for (const item of (itemsResponse.data ?? []) as InvoiceItemRow[]) {
      const invoice = asSingle(item.invoices)
      if (!isRevenueInvoiceStatus(invoice?.status)) continue
      addToMap(revenueByJobId, item.source_job_id, getInvoiceNetAmount(item))
    }

    return revenueByJobId
  }

  if (!isMissingSourceJobColumn(itemsResponse.error)) {
    throw itemsResponse.error
  }

  const invoicesResponse = await ctx.supabase
    .from('invoices')
    .select('job_id, status, total_without_vat, total_amount, total_with_vat')
    .eq('company_id', ctx.companyId)
    .in('job_id', jobIds)

  if (invoicesResponse.error) throw invoicesResponse.error

  for (const invoice of (invoicesResponse.data ?? []) as InvoiceRow[]) {
    if (!isRevenueInvoiceStatus(invoice.status)) continue
    addToMap(revenueByJobId, invoice.job_id, getInvoiceNetAmount(invoice))
  }

  return revenueByJobId
}
