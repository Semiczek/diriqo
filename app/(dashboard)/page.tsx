import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import type { CSSProperties, ReactNode } from 'react'
import DashboardShell from '../../components/DashboardShell'
import DashboardMonthPicker from '../../components/DashboardMonthPicker'
import DashboardQuickNotes from '../../components/DashboardQuickNotes'
import { getRequestDictionary } from '@/lib/i18n/server'
import { getActiveCompanyContext } from '../../lib/active-company'
import {
  endOfTodayPrague,
  endOfTomorrowPrague,
  endOfWeekPrague,
  formatMonthInputValue,
  formatPragueDateKey,
  getCurrentMonthValuePrague,
  getDaysInMonth,
  getNowPrague,
  getPraguePartsFromDate,
  getPragueWeekday,
  getMonthRangeFromValue,
  overlapsRange,
  parseDateSafe,
  PRAGUE_TZ,
  pragueWallTimeToDate,
  shiftMonthRange,
  startOfTodayPrague,
  startOfTomorrowPrague,
  startOfWeekPrague,
} from '@/lib/date/prague-time'
import {
  formatCurrency,
  formatPercent,
  formatTime,
} from '@/lib/formatters'
import {
  getPayrollRangeFromMonthValue,
  isWorkerAdvanceBackfilledFromRequest,
} from '@/lib/payroll/payroll-periods'
import {
  getEffectiveJobWorkState,
  isCompletedJob as isResolvedJobDone,
  getVisibleBillingState as getVisibleResolvedBillingState,
  isMultiDayJobRange,
  resolveJobBillingState,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '../../lib/job-status'
import type {
  BillingStateResolved,
  TimeState,
  WorkState,
} from '../../lib/job-status'
import { getQuoteStatusLabel, getQuoteStatusStyle, resolveQuoteStatus } from '../../lib/quote-status'
import { createSupabaseServerClient } from '../../lib/supabase-server'
import { buildJobGroups, getJobGroupRootId } from '../../lib/job-grouping'
import { getContractorBillingType, getWorkerType } from '@/lib/payroll-settings'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type JobRow = {
  id: string
  company_id: string | null
  parent_job_id?: string | null
  title: string | null
  address: string | null
  start_at: string | null
  end_at: string | null
  created_at?: string | null
  price: number | string | null
  customer_id?: string | null
  status?: string | null
  time_state: TimeState | null
  work_state: WorkState | null
  raw_work_state?: WorkState | null
  billing_state_resolved: BillingStateResolved | null
  assigned_total?: number | string | null
  started_total?: number | string | null
  completed_total?: number | string | null
  active_workers?: number | string | null
}

type CustomerRow = {
  id: string
  name: string | null
}

type DashboardAssignmentCostRow = {
  job_id: string | null
  profile_id: string | null
  labor_hours: number | string | null
  hourly_rate: number | string | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | string | null
  profiles?:
    | {
        default_hourly_rate?: number | string | null
        worker_type?: string | null
        contractor_billing_type?: string | null
        contractor_default_rate?: number | string | null
      }[]
    | {
        default_hourly_rate?: number | string | null
        worker_type?: string | null
        contractor_billing_type?: string | null
        contractor_default_rate?: number | string | null
      }
    | null
}

type DashboardJobCostItemRow = {
  job_id: string | null
  total_price?: number | string | null
  quantity?: number | string | null
  unit_price?: number | string | null
}

type CompanyMemberRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  is_active: boolean | null
  profiles?:
    | {
        id: string
        full_name: string | null
      }[]
    | {
        id: string
        full_name: string | null
      }
    | null
}

type AbsenceRow = {
  id: string
  company_id?: string | null
  profile_id: string | null
  status: string | null
  absence_type: string | null
  start_at: string | null
  end_at: string | null
}

type AdvanceRequestRow = {
  id: string
  company_id?: string | null
  profile_id: string | null
  status: string | null
  amount: number | string | null
  requested_amount?: number | string | null
  created_at: string | null
  requested_at?: string | null
  approved_at?: string | null
  reviewed_at?: string | null
  paid_at?: string | null
  payroll_month?: string | null
}

type WorkerAdvanceDashboardRow = {
  id: string
  profile_id: string | null
  amount: number | string | null
  issued_at: string | null
  note?: string | null
}

type QuoteDashboardRow = {
  id: string
  company_id: string | null
  customer_id: string | null
  quote_number: string
  title: string
  status: string | null
  valid_until: string | null
  total_price: number | null
  created_at: string | null
}

type WorkShiftDashboardRow = {
  id: string
  company_id?: string | null
  profile_id: string | null
  job_id?: string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override?: number | string | null
}

type JobAssignmentDashboardRow = {
  id: string
  profile_id: string | null
  job_id: string | null
  work_started_at: string | null
  work_completed_at: string | null
  jobs?:
    | {
        id: string
        company_id: string | null
        title: string | null
      }[]
    | {
        id: string
        company_id: string | null
        title: string | null
      }
    | null
}

type TodayWorkerStatusRow = {
  profileId: string | null
  name: string
  statusLabel: string
  statusSort: number
  shiftStart: string | null
  shiftEnd: string | null
  activeJobTitle: string | null
}

type ProfitChartPoint = {
  label: string
  value: number
  revenue: number
  costs: number
}

type MonthEconomyJob = {
  id: string
  title: string | null
  customer_id?: string | null
  price: number
  laborCost: number
  otherCost: number
  profit: number
  revenue: number
  margin: number | null
  start_at: string | null
  end_at: string | null
  created_at?: string | null
  waitingForInvoice: boolean
  invoiced: boolean
  completed: boolean
  timeFinished: boolean
}

type AttentionSeverity = 'critical' | 'warning' | 'ok'

type DashboardPageProps = {
  searchParams?: Promise<{
    jobs_day?: string
    summary_month?: string
    summary_week?: string
  }>
}

function asSingleRelation<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: PRAGUE_TZ,
  }).format(date)
}

function formatTimeFromDate(value: Date | null): string {
  if (!value) return '-'

  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TZ,
  }).format(value)
}

function formatShortDateTime(value: string | null): string {
  const date = parseDateSafe(value)
  if (!date) return '\u2014'

  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TZ,
  }).format(date)
}

function buildDashboardHref({
  jobsDay,
  summaryMonth,
  summaryWeek,
}: {
  jobsDay: 'today' | 'tomorrow'
  summaryMonth?: string | null
  summaryWeek?: string | null
}) {
  const params = new URLSearchParams()

  if (jobsDay === 'tomorrow') {
    params.set('jobs_day', 'tomorrow')
  }

  if (summaryMonth) {
    params.set('summary_month', summaryMonth)
  }

  if (summaryWeek) {
    params.set('summary_week', summaryWeek)
  }

  const query = params.toString()
  return query ? `/?${query}` : '/'
}

function getWeekSegmentsForMonth(monthStart: Date) {
  const daysInMonth = getDaysInMonth(monthStart)
  const monthParts = getPraguePartsFromDate(monthStart)
  const segments: Array<{
    value: string
    label: string
    start: Date
    end: Date
  }> = []

  let startDay = 1
  let weekIndex = 0

  while (startDay <= daysInMonth && weekIndex < 5) {
    const start = pragueWallTimeToDate(monthParts.year, monthParts.month, startDay, 0, 0, 0)
    const weekday = getPragueWeekday(monthParts.year, monthParts.month, startDay)
    const daysUntilSunday = weekday === 0 ? 0 : 7 - weekday
    const endDay = Math.min(daysInMonth, startDay + daysUntilSunday)
    const end = pragueWallTimeToDate(monthParts.year, monthParts.month, endDay, 23, 59, 59)

    segments.push({
      value: String(weekIndex + 1),
      label: `${weekIndex + 1}. týden`,
      start,
      end,
    })

    startDay = endDay + 1
    weekIndex += 1
  }

  return segments
}

function overlapsDay(
  startAt: string | null,
  endAt: string | null,
  dayStart: Date,
  dayEnd: Date
): boolean {
  if (!startAt && !endAt) return false

  const start = parseDateSafe(startAt)
  const end = parseDateSafe(endAt)

  if (start && end) return start <= dayEnd && end >= dayStart
  if (start) return start >= dayStart && start <= dayEnd
  return false
}

function getRelevantTimeRangeForDay(
  startAt: string | null,
  endAt: string | null,
  dayStart: Date,
  dayEnd: Date
) {
  const start = parseDateSafe(startAt)
  const end = parseDateSafe(endAt)

  const effectiveStart = start && start > dayStart ? start : dayStart
  const effectiveEnd = end && end < dayEnd ? end : dayEnd

  return {
    startLabel: formatTimeFromDate(effectiveStart),
    endLabel: formatTimeFromDate(effectiveEnd),
  }
}

function getDisplayWorkStateForDay(
  job: Pick<JobRow, 'start_at' | 'end_at' | 'work_state'>,
  dayStart: Date,
  dayEnd: Date
): WorkState | null | undefined {
  if (!isMultiDayJobRange(job.start_at, job.end_at)) {
    return job.work_state
  }

  const endAt = parseDateSafe(job.end_at)
  if (!endAt) return job.work_state

  // Multi-day job can be shown as done only on its final calendar day.
  if (job.work_state === 'done' && endAt > dayEnd) {
    return 'in_progress'
  }

  return job.work_state
}

function isDateInDateKeyRange(
  value: string | null | undefined,
  startDate: string,
  endExclusiveDate: string
) {
  const date = parseDateSafe(value)
  if (!date) return false

  const dateKey = formatPragueDateKey(date)
  return dateKey >= startDate && dateKey < endExclusiveDate
}

function getShiftHoursFromTimesOnly(shift: WorkShiftDashboardRow, now: Date): number {
  const start = parseDateSafe(shift.started_at)
  if (!start) return 0

  const end = parseDateSafe(shift.ended_at) ?? now
  if (end.getTime() <= start.getTime()) return 0

  return roundHours((end.getTime() - start.getTime()) / (1000 * 60 * 60))
}

function getTodayWorkerStatusTone(statusSort: number): CSSProperties {
  if (statusSort === 0) {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  if (statusSort === 1) {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  return {
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function getTimeStateLabel(state: TimeState | null | undefined) {
  if (state === 'future') return 'Budoucí'
  if (state === 'active') return 'V termínu'
  if (state === 'finished') return 'Hotovo'
  return 'Neznámý čas'
}

function getWorkStateLabel(state: WorkState | null | undefined) {
  if (state === 'not_started') return 'Nezahájeno'
  if (state === 'in_progress') return 'Probíhá'
  if (state === 'partially_done') return 'Částečně hotovo'
  if (state === 'done') return 'Hotovo'
  return 'Neznámý provoz'
}

function getBillingStateLabel(state: BillingStateResolved | null | undefined) {
  if (state === 'waiting_for_invoice') return 'Čeká na fakturaci'
  if (state === 'due') return 'Ve splatnosti'
  if (state === 'overdue') return 'Po splatnosti'
  if (state === 'paid') return 'Zaplaceno'
  return 'Neznámá fakturace'
}

function getDisplayTimeStateLabel(state: TimeState | null | undefined) {
  if (state === 'finished') return 'Hotovo'
  return getTimeStateLabel(state)
}

function getVisibleBillingState(
  workState: WorkState | null | undefined,
  billingState: BillingStateResolved | null | undefined
) {
  return getVisibleResolvedBillingState(workState, billingState)
}

function isCompletedJob(workState: WorkState | null | undefined) {
  return isResolvedJobDone(workState)
}

function isWaitingForInvoiceJob(job: JobRow) {
  return (
    isCompletedJob(job.work_state) &&
    getVisibleBillingState(job.work_state, job.billing_state_resolved) === 'waiting_for_invoice'
  )
}

function isInvoicedJob(job: JobRow) {
  const billingState = getVisibleBillingState(job.work_state, job.billing_state_resolved)

  return billingState === 'due' || billingState === 'overdue' || billingState === 'paid'
}

function jobToneByWorkState(state: WorkState | null | undefined): CSSProperties {
  if (state === 'not_started') {
    return { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }
  }

  if (state === 'in_progress') {
    return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }
  }

  if (state === 'partially_done') {
    return { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }
  }

  if (state === 'done') {
    return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
  }

  return { backgroundColor: '#e5e7eb', color: '#374151', border: '1px solid #d1d5db' }
}

function workerTone(absenceType: string | null) {
  const normalized = (absenceType ?? '').trim().toLowerCase()

  if (!normalized) {
    return {
      label: 'V práci',
      style: {
        backgroundColor: '#dcfce7',
        color: '#166534',
        border: '1px solid #bbf7d0',
      } as CSSProperties,
    }
  }

  return {
    label: 'Absence',
    style: {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    } as CSSProperties,
  }
}

function getAbsenceTypeLabel(absenceType: string | null) {
  const normalized = (absenceType ?? '').trim().toLowerCase()

  if (normalized.includes('vac')) return 'Dovolená'
  if (normalized.includes('holiday')) return 'Dovolená'
  if (normalized.includes('nemoc')) return 'Nemoc'
  if (normalized.includes('sick')) return 'Nemoc'
  if (normalized.includes('volno')) return 'Volno'
  return absenceType?.trim() || 'Absence'
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  noStore()
  const dictionary = await getRequestDictionary()
  const t = dictionary.dashboard

  const getTimeStateText = (state: TimeState | null | undefined) => {
    if (state === 'future') return t.future
    if (state === 'active') return t.onSchedule
    if (state === 'finished') return t.done
    return t.unknownTime
  }

  const getDisplayTimeStateText = (state: TimeState | null | undefined) =>
    state === 'finished' ? t.done : getTimeStateText(state)

  const getWorkStateText = (state: WorkState | null | undefined) => {
    if (state === 'not_started') return t.notStarted
    if (state === 'in_progress') return t.inProgress
    if (state === 'partially_done') return t.partiallyDone
    if (state === 'done') return t.done
    return t.unknownWorkState
  }

  const getBillingStateText = (state: BillingStateResolved | null | undefined) => {
    if (state === 'waiting_for_invoice') return t.waitingForInvoice
    if (state === 'due') return t.due
    if (state === 'overdue') return t.overdue
    if (state === 'paid') return t.paid
    return t.unknownBillingState
  }

  const getAbsenceTypeText = (absenceType: string | null) => {
    const normalized = (absenceType ?? '').trim().toLowerCase()
    if (normalized.includes('vac') || normalized.includes('holiday')) return t.vacation
    if (normalized.includes('nemoc') || normalized.includes('sick')) return t.sick
    return t.otherAbsence
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const selectedJobsDay =
    resolvedSearchParams?.jobs_day === 'tomorrow' ? 'tomorrow' : 'today'
  const summaryMonthConfig = getMonthRangeFromValue(resolvedSearchParams?.summary_month)
  const selectedSummaryMonth = summaryMonthConfig.value
  const selectedSummaryWeekRaw = (resolvedSearchParams?.summary_week ?? '').trim()
  const payrollMonthConfig = getPayrollRangeFromMonthValue(selectedSummaryMonth)

  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="dashboard">
        <div
          style={{
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid #fdba74',
            background: '#fff7ed',
            color: '#9a3412',
            fontWeight: 600,
          }}
        >
          Nepodarilo se dohledat aktivni firmu pro dashboard.
        </div>
      </DashboardShell>
    )
  }

  const companyId = activeCompany.companyId
  const supabase = await createSupabaseServerClient()

  const todayStart = startOfTodayPrague()
  const todayEnd = endOfTodayPrague()
  const tomorrowStart = startOfTomorrowPrague()
  const tomorrowEnd = endOfTomorrowPrague()
  const weekStart = startOfWeekPrague()
  const weekEnd = endOfWeekPrague()
  const summaryPreviousMonthRange = shiftMonthRange(summaryMonthConfig.start, -1)
  const summaryNextMonthRange = shiftMonthRange(summaryMonthConfig.start, 1)
  const previousMonthRange = summaryPreviousMonthRange
  const summaryWeekSegments = getWeekSegmentsForMonth(summaryMonthConfig.start)
  const currentMonthValue = getCurrentMonthValuePrague()
  const isCurrentSummaryMonth = selectedSummaryMonth === currentMonthValue
  const autoSummaryWeekValue = isCurrentSummaryMonth
    ? summaryWeekSegments.find((segment) => overlapsRange(todayStart, todayStart, segment.start, segment.end))
        ?.value ?? '1'
    : summaryWeekSegments[0]?.value ?? '1'
  const selectedSummaryWeek =
    summaryWeekSegments.find((segment) => segment.value === selectedSummaryWeekRaw)?.value ??
    autoSummaryWeekValue
  const selectedSummaryWeekSegment =
    summaryWeekSegments.find((segment) => segment.value === selectedSummaryWeek) ??
    summaryWeekSegments[0]

  const todayShiftDate = formatPragueDateKey(todayStart)
  const tomorrowShiftDate = formatPragueDateKey(tomorrowStart)
  const selectedDayStart = selectedJobsDay === 'tomorrow' ? tomorrowStart : todayStart
  const selectedDayEnd = selectedJobsDay === 'tomorrow' ? tomorrowEnd : todayEnd
  const selectedShiftDate = selectedJobsDay === 'tomorrow' ? tomorrowShiftDate : todayShiftDate

  const [
    jobsResponse,
    customersResponse,
    membersResponse,
    absencesResponse,
    shiftsResponse,
    advancesResponse,
    quotesResponse,
    jobParentLinksResponse,
  ] = await Promise.all([
    supabase
      .from('jobs_with_state')
      .select(
        `
          id,
          company_id,
          title,
            address,
            start_at,
            end_at,
            created_at,
            price,
            customer_id,
            status,
            time_state,
            work_state,
            billing_state_resolved,
            assigned_total,
            started_total,
            completed_total,
            active_workers
          `
        )
      .eq('company_id', companyId)
      .order('start_at', { ascending: true }),

    supabase
      .from('customers')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name', { ascending: true }),

    supabase
      .from('company_members')
      .select(
        `
          id,
          company_id,
          profile_id,
          is_active,
          profiles (
            id,
            full_name
          )
        `
      )
      .eq('company_id', companyId)
      .eq('is_active', true),

    supabase
      .from('absence_requests')
      .select('id, company_id, profile_id, status, absence_type, start_at, end_at')
      .eq('company_id', companyId),

    supabase
      .from('work_shifts')
      .select('id, company_id, profile_id, job_id, shift_date, started_at, ended_at, hours_override')
      .eq('company_id', companyId)
      .in('shift_date', [todayShiftDate, tomorrowShiftDate]),

    supabase
      .from('advance_requests')
      .select('id, company_id, profile_id, status, amount, requested_amount, created_at, requested_at, approved_at, reviewed_at, paid_at, payroll_month')
      .order('requested_at', { ascending: false }),

    supabase
      .from('quotes')
      .select('id, company_id, customer_id, quote_number, title, status, valid_until, total_price, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(4),

    supabase
      .from('jobs')
      .select('id, parent_job_id')
      .eq('company_id', companyId),
  ])
  const parentByJobId = new Map(
    ((jobParentLinksResponse.data ?? []) as Array<{ id: string; parent_job_id: string | null }>)
      .map((job) => [job.id, job.parent_job_id])
  )
  const jobs = ((jobsResponse.data ?? []) as JobRow[])
    .filter((job) => !job.company_id || job.company_id === companyId)
    .map((job) => {
      const timeState = resolveJobTimeState(job.time_state)
      const storedWorkState = resolveJobWorkState(job.work_state)
      const workState = getEffectiveJobWorkState({
        timeState,
        workState: storedWorkState,
        legacyStatus: resolveLegacyJobStatus(job.status),
        isMultiDay: isMultiDayJobRange(job.start_at, job.end_at),
        assignedCount: toNumber(job.assigned_total),
        startedCount: toNumber(job.started_total),
        completedCount: toNumber(job.completed_total),
        activeCount: toNumber(job.active_workers),
      })

      return {
        ...job,
        parent_job_id: job.parent_job_id ?? parentByJobId.get(job.id) ?? null,
        time_state: timeState,
        raw_work_state: storedWorkState,
        work_state: workState,
        billing_state_resolved: resolveJobBillingState(job.billing_state_resolved),
      }
    })
  const customers = (customersResponse.data ?? []) as CustomerRow[]
  const members = (membersResponse.data ?? []) as CompanyMemberRow[]
  const activeMemberProfileIds = new Set(
    members
      .map((member) => member.profile_id)
      .filter((profileId): profileId is string => Boolean(profileId))
  )
  const jobIds = jobs.map((job) => job.id)
  const profileIds = Array.from(activeMemberProfileIds)
  const [
    assignmentCostsResponse,
    jobCostItemsResponse,
    workerAdvancesResponse,
    activeAssignmentsResponse,
    allAssignmentsResponse,
  ] = await Promise.all([
    jobIds.length > 0
      ? supabase
          .from('job_assignments')
          .select(
            `
              job_id,
              profile_id,
              labor_hours,
              hourly_rate,
              worker_type_snapshot,
              assignment_billing_type,
              external_amount,
              profiles (
                default_hourly_rate,
                worker_type,
                contractor_billing_type,
                contractor_default_rate
              )
            `
          )
          .in('job_id', jobIds)
          .is('archived_at', null)
      : Promise.resolve({ data: [] }),

    jobIds.length > 0
      ? supabase
          .from('job_cost_items')
          .select('job_id, total_price, quantity, unit_price')
          .in('job_id', jobIds)
      : Promise.resolve({ data: [] }),

    profileIds.length > 0
      ? supabase
          .from('worker_advances')
          .select('id, profile_id, amount, issued_at, note')
          .in('profile_id', profileIds)
          .gte('issued_at', payrollMonthConfig.startDate)
          .lt('issued_at', payrollMonthConfig.endExclusiveDate)
      : Promise.resolve({ data: [] }),

    profileIds.length > 0
      ? supabase
          .from('job_assignments')
          .select(
            `
              id,
              profile_id,
              job_id,
              work_started_at,
              work_completed_at,
              jobs!inner (
                id,
                company_id,
                title
              )
            `
          )
          .in('profile_id', profileIds)
          .not('work_started_at', 'is', null)
          .is('work_completed_at', null)
          .eq('jobs.company_id', companyId)
      : Promise.resolve({ data: [] }),

    jobIds.length > 0
      ? supabase
          .from('job_assignments')
          .select('job_id')
          .in('job_id', jobIds)
          .is('archived_at', null)
      : Promise.resolve({ data: [] }),
  ])
  const assignmentCosts = (assignmentCostsResponse.data ?? []) as DashboardAssignmentCostRow[]
  const jobCostItems = (jobCostItemsResponse.data ?? []) as DashboardJobCostItemRow[]
  const absences = (absencesResponse.data ?? []) as AbsenceRow[]
  const shifts = (shiftsResponse.data ?? []) as WorkShiftDashboardRow[]
  const activeAssignments = (activeAssignmentsResponse.data ?? []) as JobAssignmentDashboardRow[]
  const allAssignments = (allAssignmentsResponse.data ?? []) as Array<{ job_id: string | null }>
  const advances = (advancesResponse.data ?? []) as AdvanceRequestRow[]
  const workerAdvances = (workerAdvancesResponse.data ?? []) as WorkerAdvanceDashboardRow[]
  const quotes = ((quotesResponse.data ?? []) as QuoteDashboardRow[]).filter(
    (quote) => !quote.company_id || quote.company_id === companyId
  )

  const customerMap = new Map(customers.map((customer) => [customer.id, customer.name ?? 'Bez zákazníka']))
  const assignmentCountByJobId = allAssignments.reduce((map, assignment) => {
    if (!assignment.job_id) return map
    map.set(assignment.job_id, (map.get(assignment.job_id) ?? 0) + 1)
    return map
  }, new Map<string, number>())

  const laborByJobId = new Map<string, number>()
  const externalLaborByJobId = new Map<string, number>()
  const otherCostsByJobId = new Map<string, number>()
  for (const assignment of assignmentCosts) {
    if (!assignment.job_id) continue

    const profileRelation = asSingleRelation(assignment.profiles)
    const workerType = getWorkerType({
      worker_type: assignment.worker_type_snapshot ?? profileRelation?.worker_type,
    })
    const billingType = getContractorBillingType(
      assignment.assignment_billing_type ?? profileRelation?.contractor_billing_type
    )
    const hourlyRate = toNumber(
      assignment.hourly_rate ??
        profileRelation?.contractor_default_rate ??
        profileRelation?.default_hourly_rate
    )
    const laborCost =
      workerType === 'contractor' && billingType !== 'hourly' && assignment.external_amount != null
        ? toNumber(assignment.external_amount)
        : toNumber(assignment.labor_hours) * hourlyRate

    if (workerType === 'contractor') {
      externalLaborByJobId.set(
        assignment.job_id,
        (externalLaborByJobId.get(assignment.job_id) ?? 0) + laborCost
      )
    } else {
      laborByJobId.set(assignment.job_id, (laborByJobId.get(assignment.job_id) ?? 0) + laborCost)
    }
  }
  const companyMonthLaborTotal = Array.from(laborByJobId.values()).reduce((sum, value) => sum + value, 0)

  for (const item of jobCostItems) {
    if (!item.job_id) continue

    const directCost =
      item.total_price != null
        ? toNumber(item.total_price)
        : toNumber(item.quantity) * toNumber(item.unit_price)

    otherCostsByJobId.set(item.job_id, (otherCostsByJobId.get(item.job_id) ?? 0) + directCost)
  }

  const isVisibleInDailyOverview = (job: JobRow, dayStart: Date, dayEnd: Date) =>
    overlapsDay(job.start_at, job.end_at, dayStart, dayEnd) && job.time_state !== 'finished'

  const summaryJobIds = new Set(
    jobs
      .map((job) => job.parent_job_id)
      .filter((parentJobId): parentJobId is string => Boolean(parentJobId))
  )
  const { jobsById, parentByJobId: groupedParentByJobId } = buildJobGroups(jobs)
  const operationalJobs = jobs.filter((job) => !summaryJobIds.has(job.id))

  const todayJobs = operationalJobs.filter((job) => isVisibleInDailyOverview(job, todayStart, todayEnd))
  const selectedJobs = operationalJobs.filter((job) =>
    isVisibleInDailyOverview(job, selectedDayStart, selectedDayEnd)
  )
  const summaryMonthJobs = operationalJobs.filter((job) =>
    overlapsRange(job.start_at, job.end_at, summaryMonthConfig.start, summaryMonthConfig.end)
  )
  const summaryPeriodJobs = selectedSummaryWeekSegment
    ? summaryMonthJobs.filter((job) =>
        overlapsRange(job.start_at, job.end_at, selectedSummaryWeekSegment.start, selectedSummaryWeekSegment.end)
      )
    : summaryMonthJobs

  const monthJobs = summaryMonthJobs
  const selectedWeekJobs = summaryPeriodJobs

  const toMonthEconomyJobs = (sourceJobs: JobRow[]) => {
    const grouped = new Map<string, MonthEconomyJob>()

    for (const job of sourceJobs) {
      const rootId = getJobGroupRootId(job.id, groupedParentByJobId)
      const rootJob = jobsById.get(rootId) ?? job
      const current = grouped.get(rootId)
      const nextLaborCost = laborByJobId.get(job.id) ?? 0
      const nextOtherCost = (otherCostsByJobId.get(job.id) ?? 0) + (externalLaborByJobId.get(job.id) ?? 0)

      const nextStart =
        [current?.start_at, job.start_at, rootJob.start_at]
          .map((value) => parseDateSafe(value))
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null

      const nextEnd =
        [current?.end_at, job.end_at, rootJob.end_at]
          .map((value) => parseDateSafe(value))
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

      const revenue = toNumber(rootJob.price)
      const laborCost = (current?.laborCost ?? 0) + nextLaborCost
      const otherCost = (current?.otherCost ?? 0) + nextOtherCost
      const profit = revenue - laborCost - otherCost
      const completed =
        (current?.completed ?? false) || isCompletedJob(rootJob.work_state) || isCompletedJob(job.work_state)
      const timeFinished =
        (current?.timeFinished ?? false) || rootJob.time_state === 'finished' || job.time_state === 'finished'
      const waitingForInvoice =
        completed &&
        ((current?.waitingForInvoice ?? false) || isWaitingForInvoiceJob(rootJob) || isWaitingForInvoiceJob(job))
      const invoiced =
        completed &&
        ((current?.invoiced ?? false) || isInvoicedJob(rootJob) || isInvoicedJob(job))

      grouped.set(rootId, {
        id: rootJob.id,
        title: rootJob.title ?? job.title ?? 'Bez názvu',
        customer_id: rootJob.customer_id ?? job.customer_id ?? null,
        // Revenue comes from the root parent job, while costs are summed
        // across the full parent + child group to avoid duplicating the parent price.
        // Dashboard profit uses completed work, independent of invoicing status.
        price: toNumber(rootJob.price),
        laborCost,
        otherCost,
        revenue,
        margin: revenue > 0 ? (profit / revenue) * 100 : null,
        start_at: nextStart ? nextStart.toISOString() : rootJob.start_at ?? job.start_at ?? null,
        end_at: nextEnd ? nextEnd.toISOString() : rootJob.end_at ?? job.end_at ?? null,
        created_at: rootJob.created_at ?? job.created_at ?? null,
        waitingForInvoice,
        invoiced,
        completed,
        timeFinished,
        profit,
      })
    }

    return Array.from(grouped.values())
  }

  const monthEconomyJobs = toMonthEconomyJobs(monthJobs)
  const monthOrdered = monthEconomyJobs
    .filter((job) => !job.completed && !job.timeFinished && !job.waitingForInvoice && !job.invoiced)
    .reduce((sum, job) => sum + job.price, 0)
  const monthCompletedJobs = monthEconomyJobs.filter((job) => job.completed)
  const monthWaitingForInvoiceJobs = monthEconomyJobs.filter((job) => job.waitingForInvoice)
  const monthInvoicedJobs = monthEconomyJobs.filter((job) => job.invoiced)
  const monthProfitJobs = monthCompletedJobs
  const monthReadyToInvoice = monthWaitingForInvoiceJobs.reduce((sum, job) => sum + job.price, 0)
  const monthInvoiced = monthInvoicedJobs.reduce((sum, job) => sum + job.price, 0)
  const monthLabor = monthProfitJobs.reduce((sum, job) => sum + job.laborCost, 0)
  const monthOther = monthProfitJobs.reduce((sum, job) => sum + job.otherCost, 0)
  const monthTotalCosts = monthLabor + monthOther
  // KPI profit is based only on completed jobs in the selected month:
  // completed job prices minus other costs minus work from job assignments.
  const monthProfit = monthProfitJobs.reduce((sum, job) => sum + job.profit, 0)

  const weekAbsences = absences.filter((item) =>
    overlapsRange(item.start_at, item.end_at, weekStart, weekEnd)
  )

  const pendingAbsences = absences.filter(
    (item) => (item.status ?? '').trim().toLowerCase() === 'pending'
  )

  const companyAdvances = advances.filter((item) => {
    if (item.company_id === companyId) return true
    if (!item.profile_id) return false
    return activeMemberProfileIds.has(item.profile_id)
  })

  const pendingAdvances = companyAdvances.filter((item) => {
    const status = (item.status ?? '').trim().toLowerCase()
    return status === 'pending' || status === 'approved'
  })
  const payrollWorkerAdvances = workerAdvances.filter(
    (item) => item.profile_id != null && activeMemberProfileIds.has(item.profile_id)
  )
  const payrollPaidAdvanceRequests = companyAdvances.filter((item) => {
    const status = (item.status ?? '').trim().toLowerCase()
    if (status !== 'paid') return false
    if (!item.profile_id || !activeMemberProfileIds.has(item.profile_id)) return false
    if (!isDateInDateKeyRange(item.paid_at, payrollMonthConfig.startDate, payrollMonthConfig.endExclusiveDate)) return false
    return !isWorkerAdvanceBackfilledFromRequest(item, payrollWorkerAdvances)
  })
  const payrollAdvanceTotal = payrollWorkerAdvances.reduce(
    (sum, item) => sum + toNumber(item.amount),
    0
  ) + payrollPaidAdvanceRequests.reduce(
    (sum, item) => sum + toNumber(item.amount ?? item.requested_amount),
    0
  )

  const jobsWithoutAssignments = operationalJobs.filter(
    (job) =>
      job.time_state !== 'finished' &&
      !isCompletedJob(job.work_state) &&
      Math.max(toNumber(job.assigned_total), assignmentCountByJobId.get(job.id) ?? 0) === 0
  )

  const overdueBillingJobs = operationalJobs.filter(
    (job) => getVisibleBillingState(job.work_state, job.billing_state_resolved) === 'overdue'
  )

  const waitingInvoiceJobs = monthWaitingForInvoiceJobs
  const waitingInvoiceTotal = monthReadyToInvoice
  const overdueBillingTotal = overdueBillingJobs.reduce((sum, job) => sum + toNumber(job.price), 0)

  const todayShifts = shifts.filter((shift) => shift.shift_date === todayShiftDate)
  const activeShifts = shifts.filter((shift) => {
    const shiftStart = parseDateSafe(shift.started_at)
    const shiftEnd = parseDateSafe(shift.ended_at)
    const now = getNowPrague()

    if (!shiftStart) return false
    if (shiftStart > now) return false
    if (shiftEnd && shiftEnd < now) return false

    return true
  })
  const selectedDayShifts = shifts.filter((shift) => shift.shift_date === selectedShiftDate)
  const selectedDayShiftCountByJob = selectedDayShifts.reduce((map, shift) => {
    if (!shift.job_id) return map
    map.set(shift.job_id, (map.get(shift.job_id) ?? 0) + 1)
    return map
  }, new Map<string, number>())

  const profitJobDetails = monthProfitJobs
    .map((job) => {
      const laborCost = job.laborCost
      const otherCost = job.otherCost
      const revenue = job.revenue
      const profit = job.profit
      const margin = job.margin

    return {
      id: job.id,
      title: job.title ?? 'Bez názvu',
      customer: customerMap.get(job.customer_id ?? '') ?? 'Bez zákazníka',
      profit,
      margin,
      laborCost,
      otherCost,
      revenue,
      price: job.price,
    }
  })

  const topJobs = profitJobDetails
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 4)

  const riskJobs = profitJobDetails
    .map((job) => {
      const laborRatio = job.revenue > 0 ? job.laborCost / job.revenue : 0
      const reasons: string[] = []

      if (job.profit < 0) reasons.push('záporný zisk')
      if (job.margin != null && job.margin <= 10) reasons.push('nízká marže')
      if (laborRatio >= 0.65) reasons.push('vysoké mzdové náklady')
      if (job.price <= 0) reasons.push('chybí cena')
      if (job.price > 0 && job.laborCost === 0 && job.otherCost === 0) reasons.push('chybí náklady')

      return { ...job, reasons }
    })
    .filter((job) => job.reasons.length > 0)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 5)

  const monthProfitByDay = new Map<number, { profit: number; revenue: number; costs: number }>()
  const selectedMonthDays = getDaysInMonth(summaryMonthConfig.start)
  for (const job of monthProfitJobs) {
    const date = parseDateSafe(job.end_at) ?? parseDateSafe(job.start_at) ?? parseDateSafe(job.created_at)
    if (!date || date < summaryMonthConfig.start || date > summaryMonthConfig.end) continue

    const day = getPraguePartsFromDate(date).day
    const current = monthProfitByDay.get(day) ?? { profit: 0, revenue: 0, costs: 0 }
    const laborCost = job.laborCost
    const otherCost = job.otherCost
    monthProfitByDay.set(day, {
      profit: current.profit + job.profit,
      revenue: current.revenue + job.revenue,
      costs: current.costs + laborCost + otherCost,
    })
  }
  const profitChartPoints: ProfitChartPoint[] = Array.from({ length: selectedMonthDays }, (_, index) => {
    const day = index + 1
    const point = monthProfitByDay.get(day) ?? { profit: 0, revenue: 0, costs: 0 }
    return {
      label: String(day),
      value: point.profit,
      revenue: point.revenue,
      costs: point.costs,
    }
  })
  const hasProfitChartData = profitChartPoints.some(
    (point) => point.value !== 0 || point.revenue !== 0 || point.costs !== 0
  )

  const nowPrague = getNowPrague()
  const workedTodayByProfile = members
    .map((member) => {
      const profile = asSingleRelation(member.profiles)
      const totalHours = todayShifts
        .filter((shift) => shift.profile_id === member.profile_id)
        .reduce((sum, shift) => sum + getShiftHoursFromTimesOnly(shift, nowPrague), 0)

      return {
        profileId: member.profile_id,
        name: profile?.full_name ?? 'Bez jména',
        hours: roundHours(totalHours),
      }
    })
    .filter((row) => row.hours > 0)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'cs'))
  const workedTodayHours = workedTodayByProfile.reduce((sum, row) => sum + row.hours, 0)
  const memberNameByProfileId = new Map(
    members
      .map((member) => {
        const profile = asSingleRelation(member.profiles)
        return member.profile_id
          ? [member.profile_id, profile?.full_name ?? 'Bez jména']
          : null
      })
      .filter((entry): entry is [string, string] => Boolean(entry))
  )
  const latestTodayShiftByProfile = todayShifts.reduce((map, shift) => {
    const profileId = shift.profile_id?.trim()
    if (!profileId || !activeMemberProfileIds.has(profileId)) return map

    const existing = map.get(profileId)
    const existingTime =
      parseDateSafe(existing?.started_at ?? existing?.ended_at ?? existing?.shift_date)?.getTime() ?? -1
    const nextTime =
      parseDateSafe(shift.started_at ?? shift.ended_at ?? shift.shift_date)?.getTime() ?? -1

    if (!existing || nextTime >= existingTime) {
      map.set(profileId, shift)
    }

    return map
  }, new Map<string, WorkShiftDashboardRow>())
  const activeAssignmentByProfile = activeAssignments.reduce((map, assignment) => {
    const profileId = assignment.profile_id?.trim()
    if (!profileId || !activeMemberProfileIds.has(profileId)) return map

    const existing = map.get(profileId)
    const existingTime = parseDateSafe(existing?.work_started_at)?.getTime() ?? -1
    const nextTime = parseDateSafe(assignment.work_started_at)?.getTime() ?? -1

    if (!existing || nextTime >= existingTime) {
      map.set(profileId, assignment)
    }

    return map
  }, new Map<string, JobAssignmentDashboardRow>())
  const todaysWorkers = Array.from(
    new Set([...latestTodayShiftByProfile.keys(), ...activeAssignmentByProfile.keys()])
  )
    .map((profileId) => {
      const shift = latestTodayShiftByProfile.get(profileId) ?? null
      const assignment = activeAssignmentByProfile.get(profileId) ?? null
      const assignmentJob = asSingleRelation(assignment?.jobs)

      let statusLabel = 'Ukončil směnu'
      let statusSort = 2

      if (assignment) {
        statusLabel = 'Pracuje na zakázce'
        statusSort = 0
      } else if (shift?.started_at && !shift.ended_at) {
        statusLabel = 'Na směně'
        statusSort = 1
      }

      return {
        profileId,
        name: memberNameByProfileId.get(profileId) ?? 'Bez jména',
        statusLabel,
        statusSort,
        shiftStart: shift?.started_at ?? null,
        shiftEnd: shift?.ended_at ?? null,
        activeJobTitle: assignmentJob?.title ?? null,
      } satisfies TodayWorkerStatusRow
    })
    .sort(
      (a, b) =>
        a.statusSort - b.statusSort || a.name.localeCompare(b.name, 'cs') || a.profileId?.localeCompare(b.profileId ?? '', 'cs') || 0
    )

  const actionPanels = [
    {
      key: 'unassigned',
      label: 'Zakázky bez pracovníků',
      value: jobsWithoutAssignments.length,
      severity: jobsWithoutAssignments.length > 0 ? 'critical' : 'ok',
      emptyText: 'Všechny aktuální zakázky mají pracovníky.',
      items: jobsWithoutAssignments.map((job) => ({
        id: job.id,
        title: job.title ?? t.unnamedJob,
        customer: customerMap.get(job.customer_id ?? '') ?? t.noCustomer,
        meta: [formatShortDateTime(job.start_at), job.address].filter(Boolean).join(' • '),
        href: `/jobs/${job.id}`,
        actionHref: `/jobs/${job.id}`,
        actionLabel: 'Přiřadit pracovníka',
      })),
    },
    {
      key: 'invoice',
      label: 'Čeká na fakturaci',
      value: waitingInvoiceJobs.length,
      severity: waitingInvoiceJobs.length > 0 ? 'warning' : 'ok',
      emptyText: 'Žádná hotová zakázka nečeká na fakturaci.',
      items: waitingInvoiceJobs.map((job) => ({
        id: job.id,
        title: job.title ?? t.unnamedJob,
        customer: customerMap.get(job.customer_id ?? '') ?? t.noCustomer,
        meta: [formatShortDateTime(job.end_at ?? job.start_at), formatCurrency(toNumber(job.price))]
          .filter(Boolean)
          .join(' • '),
        href: `/jobs/${job.id}`,
        actionHref: job.customer_id
          ? `/invoices/new?customerId=${job.customer_id}&month=${selectedSummaryMonth}`
          : `/invoices/new?month=${selectedSummaryMonth}`,
        actionLabel: 'Vytvořit fakturu',
      })),
    },
    {
      key: 'overdue',
      label: 'Zakázky po splatnosti',
      value: overdueBillingJobs.length,
      severity: overdueBillingJobs.length > 0 ? 'critical' : 'ok',
      emptyText: 'Nic není po splatnosti.',
      items: overdueBillingJobs.map((job) => ({
        id: job.id,
        title: job.title ?? t.unnamedJob,
        customer: customerMap.get(job.customer_id ?? '') ?? t.noCustomer,
        meta: [formatShortDateTime(job.end_at ?? job.start_at), formatCurrency(toNumber(job.price))]
          .filter(Boolean)
          .join(' • '),
        href: `/jobs/${job.id}`,
        actionHref: `/jobs/${job.id}`,
        actionLabel: 'Označit zaplaceno',
      })),
    },
    {
      key: 'advances',
      label: 'Čekající zálohy',
      value: pendingAdvances.length,
      severity: pendingAdvances.length > 0 ? 'warning' : 'ok',
      emptyText: 'Žádné zálohy nečekají na zpracování.',
      items: pendingAdvances.map((advance) => ({
        id: advance.id,
        title: memberNameByProfileId.get(advance.profile_id ?? '') ?? 'Pracovník',
        customer: 'Žádost o zálohu',
        meta: [formatCurrency(toNumber(advance.amount ?? advance.requested_amount)), formatShortDateTime(advance.requested_at ?? advance.created_at)]
          .filter(Boolean)
          .join(' • '),
        href: '/advance-requests',
        actionHref: '/advance-requests',
        actionLabel: 'Vyřídit zálohu',
      })),
    },
    {
      key: 'absences',
      label: 'Čekající absence',
      value: pendingAbsences.length,
      severity: pendingAbsences.length > 0 ? 'warning' : 'ok',
      emptyText: 'Žádné absence nečekají na schválení.',
      items: pendingAbsences.map((absence) => ({
        id: absence.id,
        title: memberNameByProfileId.get(absence.profile_id ?? '') ?? 'Pracovník',
        customer: 'Žádost o nepřítomnost',
        meta: [formatDateLabel(parseDateSafe(absence.start_at) ?? todayStart), formatDateLabel(parseDateSafe(absence.end_at) ?? parseDateSafe(absence.start_at) ?? todayStart)]
          .filter(Boolean)
          .join(' • '),
        href: '/absences',
        actionHref: '/absences',
        actionLabel: 'Schválit / zamítnout',
      })),
    },
  ] satisfies Array<{
    key: string
    label: string
    value: number
    severity: AttentionSeverity
    emptyText: string
    items: Array<{
      id: string
      title: string
      customer: string
      meta: string
      href: string
      actionHref: string
      actionLabel: string
    }>
  }>

  const issueCount =
    jobsWithoutAssignments.length +
    overdueBillingJobs.length +
    waitingInvoiceJobs.length +
    pendingAdvances.length +
    pendingAbsences.length
  const todayJobsWithoutAssignments = jobsWithoutAssignments.filter((job) =>
    isVisibleInDailyOverview(job, todayStart, todayEnd)
  )
  const todayProblemCount = todayJobsWithoutAssignments.length + overdueBillingJobs.length
  const companyStateStyle = monthProfit < 0 ? companyStateCardLoss : companyStateCardProfit
  const companyStateSentence =
    monthProfit < 0
      ? `Firma je ve ztrátě za ${summaryMonthConfig.label}.`
      : `Firma je v zisku za ${summaryMonthConfig.label}.`
  const companyStateNotes = [
    monthInvoiced > 0 ? `Celkem vyfakturováno ${formatCurrency(monthInvoiced)}.` : null,
    monthReadyToInvoice > 0 ? `Celkem k fakturaci ${formatCurrency(monthReadyToInvoice)}.` : null,
    monthOrdered > 0 ? `Celkem objednáno tento měsíc ${formatCurrency(monthOrdered)}.` : null,
    overdueBillingTotal > 0 ? `Celkem po splatnosti ${formatCurrency(overdueBillingTotal)}.` : null,
    riskJobs.length > 0 ? 'Některé zakázky vyžadují kontrolu.' : null,
    issueCount === 0 ? 'Dnes není nic kritického k řešení.' : null,
  ].filter(Boolean)
  const firstChartValue = profitChartPoints.find((point) => point.value !== 0)?.value ?? 0
  const lastChartValue = [...profitChartPoints].reverse().find((point) => point.value !== 0)?.value ?? 0
  const chartComment = !hasProfitChartData
    ? 'Zatím není dost dat pro graf.'
    : lastChartValue >= firstChartValue
      ? 'Zisk za měsíc zatím roste.'
      : 'Zisk kolísá, zkontroluj rizikové zakázky.'

  const summary = {
    jobs_total: selectedWeekJobs.length,
    jobs_future: selectedWeekJobs.filter((job) => job.time_state === 'future').length,
    jobs_active: selectedWeekJobs.filter((job) => job.time_state === 'active').length,
    jobs_finished: selectedWeekJobs.filter((job) => job.time_state === 'finished').length,
    jobs_not_started: selectedWeekJobs.filter((job) => job.work_state === 'not_started').length,
    jobs_in_progress: selectedWeekJobs.filter((job) => job.work_state === 'in_progress').length,
    jobs_partially_done: selectedWeekJobs.filter((job) => job.work_state === 'partially_done').length,
    jobs_done: selectedWeekJobs.filter((job) => job.work_state === 'done').length,
    jobs_waiting_for_invoice: selectedWeekJobs.filter(isWaitingForInvoiceJob).length,
    jobs_due: selectedWeekJobs.filter(
      (job) => getVisibleBillingState(job.work_state, job.billing_state_resolved) === 'due'
    ).length,
    jobs_overdue: selectedWeekJobs.filter(
      (job) => getVisibleBillingState(job.work_state, job.billing_state_resolved) === 'overdue'
    ).length,
    jobs_paid: selectedWeekJobs.filter(
      (job) => getVisibleBillingState(job.work_state, job.billing_state_resolved) === 'paid'
    ).length,
  }

  return (
    <DashboardShell activeItem="dashboard">
      <div style={pageWrap}>
        <style>{`
          .dashboard-kpi-card:hover {
            box-shadow: 0 14px 32px rgba(15, 23, 42, 0.09) !important;
            border-color: rgba(37, 99, 235, 0.16) !important;
          }
        `}</style>
        <section style={companyStateStyle}>
          <div style={heroGlowOne} />
          <div style={heroGlowTwo} />
          <div style={companyStateMain}>
            <div style={heroLeftStack}>
              <div>
                <h1 style={stateTitle}>Přehled firmy</h1>
                <div style={heroStatusRow}>
                  <span style={heroDatePill}>{formatDateLabel(todayStart)}</span>
                </div>
                <p style={stateText}>
                  Objednávky k odbavení za {summaryMonthConfig.label}: {formatCurrency(monthOrdered)}.
                </p>
              </div>

              <div style={stateFooter}>
                <div style={monthControls}>
                  <Link
                    href={buildDashboardHref({
                      jobsDay: selectedJobsDay,
                      summaryMonth: formatMonthInputValue(summaryPreviousMonthRange.start),
                    })}
                    style={monthNavLink}
                  >
                    {t.previousMonth}
                  </Link>

                  <DashboardMonthPicker
                    selectedMonth={selectedSummaryMonth}
                    selectedJobsDay={selectedJobsDay}
                    inputStyle={monthInput}
                  />

                  <Link
                    href={buildDashboardHref({
                      jobsDay: selectedJobsDay,
                      summaryMonth: getCurrentMonthValuePrague(),
                    })}
                    style={monthNavLink}
                  >
                    {t.currentMonthLink}
                  </Link>

                  <Link
                    href={buildDashboardHref({
                      jobsDay: selectedJobsDay,
                      summaryMonth: formatMonthInputValue(summaryNextMonthRange.start),
                    })}
                    style={monthNavLink}
                  >
                    {t.nextMonth}
                  </Link>
                </div>

                <div style={quickActions}>
                  <QuickLink href="/jobs/new" label="Nová zakázka" primary />
                  <QuickLink href="/jobs" label="Zakázky" />
                  <QuickLink href="/customers" label={t.customers} />
                </div>
              </div>
            </div>

            <DashboardQuickNotes storageKey={`diriqo:dashboard:quick-notes:${companyId}`} />
          </div>
        </section>

        <section style={kpiSection}>
          <div style={kpiHeader}>
            <div>
              <div style={summaryEyebrow}>KPI</div>
              <div style={kpiTitle}>Čísla za {summaryMonthConfig.label}</div>
            </div>
          </div>

          <div style={statsGrid}>
            <StatCard
              title="Dnešní zakázky"
              value={String(todayJobs.length)}
              subvalue="Naplánované nebo běžící dnes"
              detail="Rychlý stav dnešního provozu"
              accent="#2563eb"
            />
            <StatCard
              title="Aktivní pracovníci"
              value={String(todaysWorkers.length)}
              subvalue="Lidé na směně nebo u zakázky"
              detail="Kdo je právě k dispozici"
              accent="#16a34a"
            />
            <StatCard
              title="Hotovo tento měsíc"
              value={String(monthCompletedJobs.length)}
              subvalue={`Dokončené zakázky za ${summaryMonthConfig.label}`}
              detail="Hotová práce v měsíci"
              accent="#8b5cf6"
            />
            <StatCard
              title="Čeká na fakturaci"
              value={formatCurrency(waitingInvoiceTotal)}
              subvalue={`${waitingInvoiceJobs.length} zakázky čekají na fakturu`}
              detail="Hodnota hotové práce k vyfakturování"
              accent="#f97316"
              urgent={waitingInvoiceTotal > 0 || waitingInvoiceJobs.length > 0}
            />
            <StatCard
              title="Odhadovaný zisk"
              value={formatCurrency(monthProfit)}
              subvalue="Po práci a nákladech"
              detail="Orientační ekonomika firmy"
              accent="#06b6d4"
              highlight
            />
          </div>
        </section>

        <section id="command-center" style={actionStrip}>
          <div style={actionStripHeader}>
            <div>
              <div style={stripEyebrow}>Command center</div>
              <div style={stripTitle}>Co potřebuje pozornost</div>
              <div style={stripHint}>Klikni na problém, otevři seznam a vyřeš ho přímo odsud.</div>
            </div>
            {issueCount === 0 ? <div style={attentionOkBadge}>Vše důležité je v klidu</div> : null}
          </div>
          {issueCount === 0 ? (
            <EmptyState
              icon="✓"
              title="Vše důležité je v klidu"
              text="Dnes tu nejsou kritické provozní ani finanční věci k řešení."
            />
          ) : (
            <div style={actionStripGrid}>
              {actionPanels.filter((item) => item.value > 0).map((item) =>
                <ActionDisclosure
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  severity={item.severity}
                  items={item.items}
                  emptyText={item.emptyText}
                />
              )}
            </div>
          )}
        </section>

        <section id="dnesni-zakazky" style={operationsPanel}>
          <div style={operationsHeader}>
            <div>
              <div style={panelTitle}>Dnes</div>
              <div style={panelSubtitle}>Lidé v práci, dnešní zakázky a odpracované hodiny v jednom přehledu.</div>
            </div>
            <div style={monthBadge}>{formatDateLabel(todayStart)}</div>
          </div>

          <div style={operationsSummaryGrid}>
            <OperationMetric label="V práci" value={todaysWorkers.length} />
            <OperationMetric label="Dnešní zakázky" value={todayJobs.length} />
            <OperationMetric label="Odpracováno" value={`${roundHours(workedTodayHours)} h`} />
          </div>

          {todaysWorkers.length === 0 ? (
            <EmptyState
              icon="P"
              title="Zatím nikdo není v práci"
              text="Až pracovník zahájí směnu nebo práci na zakázce, uvidíš ho tady."
              actionHref="/jobs/new"
              actionLabel="Nová zakázka"
            />
          ) : (
            <div style={todayWorkerList}>
              {todaysWorkers.slice(0, 6).map((worker) => (
                <Link
                  key={worker.profileId ?? worker.name}
                  href={worker.profileId ? `/workers/${worker.profileId}` : '/workers'}
                  style={todayWorkerRow}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={workerName}>{worker.name}</div>
                    <div style={todayWorkerMeta}>
                      Začátek: {formatTime(worker.shiftStart)}
                      {worker.activeJobTitle ? ` • ${worker.activeJobTitle}` : ''}
                    </div>
                  </div>

                  <div style={{ ...pillBase, ...getTodayWorkerStatusTone(worker.statusSort) }}>
                    {worker.statusLabel}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section style={dashboardJobsGrid}>
          <div style={operationsPanel}>
            <div style={operationsHeader}>
              <div>
                <div style={panelTitle}>Zakázky dnes</div>
                <div style={panelSubtitle}>Rychlý plán na dnes nebo zítra.</div>
              </div>
              <div style={dayToggleWrap}>
                <Link
                  href={buildDashboardHref({
                    jobsDay: 'today',
                    summaryMonth: selectedSummaryMonth,
                    summaryWeek: selectedSummaryWeek,
                  })}
                  style={{
                    ...dayToggleLink,
                    ...(selectedJobsDay === 'today' ? dayToggleLinkActive : {}),
                  }}
                >
                  {t.todayToggle}
                </Link>
                <Link
                  href={buildDashboardHref({
                    jobsDay: 'tomorrow',
                    summaryMonth: selectedSummaryMonth,
                    summaryWeek: selectedSummaryWeek,
                  })}
                  style={{
                    ...dayToggleLink,
                    ...(selectedJobsDay === 'tomorrow' ? dayToggleLinkActive : {}),
                  }}
                >
                  {t.tomorrowToggle}
                </Link>
              </div>
            </div>

            <div style={operationsSummaryGrid}>
              <OperationMetric label="Zakázky" value={selectedJobs.length} />
              <OperationMetric label="Směny" value={selectedDayShifts.length} />
            </div>

            {selectedJobs.length === 0 ? (
              <EmptyState
                icon="Z"
                title={selectedJobsDay === 'today' ? 'Zatím žádné zakázky pro tento den.' : 'Na zítra nejsou žádné zakázky.'}
                text="Vytvoř první zakázku a přiřaď pracovníka."
                actionHref="/jobs/new"
                actionLabel="Nová zakázka"
              />
            ) : (
              <div style={compactScrollWindow}>
                <div style={stack10}>
                  {selectedJobs.slice(0, 6).map((job) => {
                    const customer = customerMap.get(job.customer_id ?? '') ?? t.noCustomer
                    const relevantTimeRange = getRelevantTimeRangeForDay(
                      job.start_at,
                      job.end_at,
                      selectedDayStart,
                      selectedDayEnd
                    )
                    const displayWorkState = getDisplayWorkStateForDay(
                      job,
                      selectedDayStart,
                      selectedDayEnd
                    )
                    const badgeTone = jobToneByWorkState(displayWorkState)
                    const selectedDayShiftCount = selectedDayShiftCountByJob.get(job.id) ?? 0
                    const selectedDayShiftLabel =
                      selectedDayShiftCount > 0 ? ` | Směny: ${selectedDayShiftCount}` : ''

                    return (
                      <Link key={job.id} href={`/jobs/${job.id}`} style={compactJobRow}>
                        <div style={jobTimeCol}>
                          <div style={jobTime}>{relevantTimeRange.startLabel}</div>
                          <div style={jobTimeMuted}>{relevantTimeRange.endLabel}</div>
                        </div>

                        <div style={jobMainCol}>
                          <div style={jobTitle}>{job.title ?? t.unnamedJob}</div>
                          <div style={jobMeta}>{customer}</div>
                          <div style={jobSubmeta}>
                            {getDisplayTimeStateText(job.time_state)}
                            {selectedDayShiftLabel}
                          </div>
                        </div>

                        <div style={{ ...badgeTone, ...pillBase }}>
                          {getWorkStateText(displayWorkState)}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={operationsPanel}>
            <div style={operationsHeader}>
              <div>
                <div style={panelTitle}>Zakázky v měsíci</div>
                <div style={panelSubtitle}>Naplánované zakázky rozdělené po týdnech.</div>
              </div>
              <div style={weekToggleWrap}>
                {summaryWeekSegments.map((segment) => (
                  <Link
                    key={segment.value}
                    href={buildDashboardHref({
                      jobsDay: selectedJobsDay,
                      summaryMonth: selectedSummaryMonth,
                      summaryWeek: segment.value,
                    })}
                    style={{
                      ...weekToggleLink,
                      ...(selectedSummaryWeek === segment.value ? weekToggleLinkActive : {}),
                    }}
                  >
                    {segment.label}
                  </Link>
                ))}
              </div>
            </div>

            <div style={operationsSummaryGrid}>
              <OperationMetric label="Zakázky v týdnu" value={selectedWeekJobs.length} />
              <OperationMetric label="Dokončeno" value={summary.jobs_done} />
              <OperationMetric label="K fakturaci" value={summary.jobs_waiting_for_invoice} />
            </div>

            {selectedWeekJobs.length === 0 ? (
              <EmptyState text="V tomto týdnu nejsou žádné zakázky." />
            ) : (
              <div style={compactScrollWindow}>
                <div style={stack10}>
                  {selectedWeekJobs
                    .slice()
                    .sort((a, b) => {
                      const aDate = parseDateSafe(a.start_at)?.getTime() ?? 0
                      const bDate = parseDateSafe(b.start_at)?.getTime() ?? 0
                      return aDate - bDate
                    })
                    .slice(0, 6)
                    .map((job) => {
                      const customer = customerMap.get(job.customer_id ?? '') ?? t.noCustomer
                      const visibleBillingState = getVisibleBillingState(job.work_state, job.billing_state_resolved)
                      const badgeTone = jobToneByWorkState(job.work_state)

                      return (
                        <Link key={job.id} href={`/jobs/${job.id}`} style={compactJobRow}>
                          <div style={jobTimeCol}>
                            <div style={jobTime}>{formatDateLabel(parseDateSafe(job.start_at) ?? getNowPrague())}</div>
                            <div style={jobTimeMuted}>{formatShortDateTime(job.end_at)}</div>
                          </div>

                          <div style={jobMainCol}>
                            <div style={jobTitle}>{job.title ?? t.unnamedJob}</div>
                            <div style={jobMeta}>{customer}</div>
                            <div style={jobSubmeta}>
                              {formatCurrency(toNumber(job.price))}
                              {visibleBillingState ? ` • ${getBillingStateText(job.billing_state_resolved)}` : ''}
                            </div>
                          </div>

                          <div style={{ ...badgeTone, ...pillBase }}>
                            {getWorkStateText(job.work_state)}
                          </div>
                        </Link>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={operationsPanel}>
          <div style={operationsHeader}>
            <div>
              <div style={panelTitle}>Tento měsíc</div>
              <div style={panelSubtitle}>Vývoj zisku a stručný rozpad peněz za {summaryMonthConfig.label}.</div>
            </div>
            <div style={monthBadge}>{summaryMonthConfig.label}</div>
          </div>

          <div style={monthOverviewGrid}>
            <div style={compactChartPanel}>
              <div style={chartCommentBox}>{chartComment}</div>
              {hasProfitChartData ? (
                <MonthlyProfitChart points={profitChartPoints} />
              ) : (
                <EmptyState text="Zatím není dost dat pro graf." />
              )}
            </div>

            <div style={financeTable}>
              <EconomyLine label="Objednáno" value={formatCurrency(monthOrdered)} />
              <EconomyLine label={t.invoiced} value={formatCurrency(monthInvoiced)} />
              <EconomyLine label="Nevyfakturováno" value={formatCurrency(monthReadyToInvoice)} />
              <EconomyLine label="Práce" value={formatCurrency(monthLabor)} />
              <EconomyLine label={t.otherCosts} value={formatCurrency(monthOther)} />
              <EconomyLine label="Vyplacené zálohy" value={formatCurrency(payrollAdvanceTotal)} />
              <EconomyLine label="Zisk" value={formatCurrency(monthProfit)} strong />
            </div>
          </div>
        </section>

        <section style={jobDecisionGrid}>
          <Panel title="Nejziskovější zakázky" subtitle="Zakázky, které ve vybraném měsíci nejvíc pomáhají výsledku.">
            {topJobs.length === 0 ? (
              <EmptyState text="Zatím tu nejsou ziskové zakázky." />
            ) : (
              <div style={compactScrollWindow}>
                <div style={stack10}>
                {topJobs.map((job) => (
                  <JobProfitRow key={job.id} job={job} />
                ))}
                </div>
              </div>
            )}
          </Panel>

          <div style={riskPanelWrap}>
            <Panel title="Zakázky k prověření" subtitle="Nízká marže, vysoká práce nebo chybějící čísla.">
              {riskJobs.length === 0 ? (
                <EmptyState text="Nic akutního k prověření." />
              ) : (
                <div style={compactScrollWindow}>
                  <div style={stack10}>
                  {riskJobs.map((job) => (
                    <JobProfitRow key={job.id} job={job} warning={job.reasons.join(', ')} />
                  ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </section>

        <section style={summaryTripleGrid}>
          <Panel title={t.quotesTitle} subtitle={t.quotesSubtitle}>
            {quotes.length === 0 ? (
              <EmptyState text={t.noQuotes} />
            ) : (
              <div style={compactScrollWindow}>
                <div style={stack10}>
                {quotes.map((quote) => {
                  const resolvedStatus = resolveQuoteStatus(quote.status, quote.valid_until)
                  const customer = customerMap.get(quote.customer_id ?? '') ?? t.noCustomerPlain

                  return (
                    <Link
                      key={quote.id}
                      href={
                        quote.customer_id
                          ? `/customers/${quote.customer_id}/quotes/${quote.id}`
                          : '/cenove-nabidky'
                      }
                      style={dashboardListLink}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={dashboardListTitle}>{quote.title || quote.quote_number}</div>
                        <div style={dashboardListMeta}>
                          {quote.quote_number} • {customer}
                        </div>
                        <div style={dashboardListSubmeta}>
                          {formatShortDateTime(quote.created_at)} • {formatCurrency(quote.total_price)}
                        </div>
                      </div>

                      <div style={{ ...pillBase, ...getQuoteStatusStyle(resolvedStatus) }}>
                        {getQuoteStatusLabel(resolvedStatus)}
                      </div>
                    </Link>
                  )
                })}
                </div>
              </div>
            )}
          </Panel>

          <Panel title={t.weekAbsencesTitle} subtitle={t.weekAbsencesSubtitle}>
            {weekAbsences.length === 0 ? (
              <EmptyState text={t.noWeekAbsences} />
            ) : (
              <div style={compactScrollWindow}>
                <div style={stack10}>
                {weekAbsences
                  .map((absence) => {
                    const member = members.find((item) => item.profile_id === absence.profile_id)
                    const profile = asSingleRelation(member?.profiles)

                    return {
                      id: absence.id,
                      profileId: absence.profile_id,
                      name: profile?.full_name ?? t.unnamedWorker,
                      label: getAbsenceTypeText(absence.absence_type),
                      startAt: absence.start_at,
                      endAt: absence.end_at,
                    }
                  })
                  .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
                  .map((absence) => (
                    <Link
                      key={absence.id}
                      href={absence.profileId ? `/workers/${absence.profileId}` : '/absences'}
                      style={workerRowLink}
                    >
                      <div>
                        <div style={workerName}>{absence.name}</div>
                        <div style={profitJobMeta}>
                          {formatShortDateTime(absence.startAt)} - {formatShortDateTime(absence.endAt)}
                        </div>
                      </div>
                      <div
                        style={{
                          ...pillBase,
                          ...workerTone(absence.label).style,
                        }}
                      >
                        {absence.label}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </section>
      </div>
    </DashboardShell>
  )
}

function MiniHeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={miniHeroStat}>
      <div style={miniHeroLabel}>{label}</div>
      <div style={miniHeroValue}>{value}</div>
    </div>
  )
}

function QuickLink({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link href={href} style={primary ? quickLinkPrimary : quickLink}>
      {label}
    </Link>
  )
}

function HeroTodayLine({
  icon,
  value,
  label,
  urgent = false,
}: {
  icon: string
  value: number
  label: string
  urgent?: boolean
}) {
  return (
    <div style={heroTodayLine}>
      <span style={urgent ? heroTodayIconUrgent : heroTodayIcon}>{icon}</span>
      <strong style={urgent ? heroTodayValueUrgent : heroTodayValue}>{value}</strong>
      <span style={heroTodayLabel}>{label}</span>
    </div>
  )
}

function TodaySummaryItem({
  label,
  value,
  hint,
  accent,
  icon,
  urgent = false,
}: {
  label: string
  value: number | string
  hint: string
  accent: string
  icon?: string
  urgent?: boolean
}) {
  return (
    <div
      style={{
        ...todaySummaryItem,
        borderColor: urgent ? `${accent}44` : 'rgba(226, 232, 240, 0.9)',
        background: urgent ? `linear-gradient(145deg, ${accent}10, rgba(255,255,255,0.96))` : todaySummaryItem.background,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          ...todaySummaryIcon,
          borderColor: `${accent}33`,
          backgroundColor: `${accent}12`,
        }}
      >
        {icon ? <span style={todaySummaryIconGlyph}>{icon}</span> : <span style={{ ...todaySummaryIconDot, backgroundColor: accent }} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={todaySummaryLabel}>{label}</span>
        <span style={todaySummaryHint}>{hint}</span>
      </span>
      <strong style={{ ...todaySummaryValue, color: urgent ? accent : '#0f172a' }}>{value}</strong>
    </div>
  )
}

function StatCard({
  title,
  value,
  subvalue,
  detail,
  icon,
  accent = '#2563eb',
  highlight = false,
  urgent = false,
}: {
  title: string
  value: string
  subvalue: string
  detail?: string
  icon?: string
  accent?: string
  highlight?: boolean
  urgent?: boolean
}) {
  const cardStyle = highlight ? highlightedStatCard : urgent ? urgentStatCard : statCard

  return (
    <div className="dashboard-kpi-card" style={cardStyle}>
      <div style={statCardTopRow}>
        <div style={highlight ? highlightedStatTitle : urgent ? urgentStatTitle : statTitle}>{title}</div>
        {icon ? (
          <div
            style={{
              ...statIcon,
              background: highlight
                ? 'rgba(255,255,255,0.12)'
                : `linear-gradient(135deg, ${accent}22, ${accent}10)`,
              borderColor: highlight ? 'rgba(255,255,255,0.18)' : `${accent}33`,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: highlight ? '13px' : '11px',
                height: highlight ? '13px' : '11px',
                borderRadius: '999px',
                background: highlight
                  ? 'linear-gradient(135deg, #ffffff, #67e8f9)'
                  : `linear-gradient(135deg, ${accent}, ${accent}88)`,
                boxShadow: highlight
                  ? '0 0 16px rgba(103, 232, 249, 0.75)'
                  : `0 0 14px ${accent}55`,
              }}
            />
          </div>
        ) : null}
      </div>
      <div style={highlight ? highlightedStatValue : urgent ? urgentStatValue : statValue}>{value}</div>
      <div style={highlight ? highlightedStatSubvalue : urgent ? urgentStatSubvalue : statSubvalue}>{subvalue}</div>
      {detail ? (
        <div style={highlight ? highlightedStatDetail : statDetail}>{detail}</div>
      ) : null}
      <div style={{ ...statAccent, backgroundColor: highlight ? '#22d3ee' : accent }} />
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div style={panel}>
      <div style={panelHeader}>
        <div style={panelTitle}>{title}</div>
        <div style={panelSubtitle}>{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function EmptyState({
  text,
  title,
  icon = '•',
  actionHref,
  actionLabel,
}: {
  text: string
  title?: string
  icon?: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div style={emptyState}>
      <div style={emptyIcon}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        {title ? <div style={emptyTitle}>{title}</div> : null}
        <div>{text}</div>
        {actionHref && actionLabel ? (
          <Link href={actionHref} style={emptyAction}>
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function AttentionRow({
  href,
  label,
  value,
}: {
  href: string
  label: string
  value: number
}) {
  return (
    <Link href={href} style={attentionRow}>
      <div style={attentionLabel}>{label}</div>
      <div style={attentionValue}>{value}</div>
    </Link>
  )
}

function ActionRow({
  href,
  label,
  value,
  severity,
}: {
  href: string
  label: string
  value: number
  severity: AttentionSeverity
}) {
  const tone = actionSeverityStyle(severity)
  const statusLabel = value === 0 ? 'OK' : severity === 'critical' ? 'kritické' : 'řešit'

  return (
    <Link href={href} style={{ ...actionRow, borderColor: tone.border, backgroundColor: tone.background }}>
      <div style={{ ...actionDot, backgroundColor: tone.dot }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={actionLabel}>{label}</div>
        <div style={actionStatus}>{statusLabel}</div>
      </div>
      <div style={{ ...actionValue, color: tone.text }}>{value}</div>
    </Link>
  )
}

function ActionDisclosure({
  label,
  value,
  severity,
  items,
  emptyText,
}: {
  label: string
  value: number
  severity: AttentionSeverity
  items: Array<{
    id: string
    title: string
    customer: string
    meta: string
    href: string
    actionHref: string
    actionLabel: string
  }>
  emptyText: string
}) {
  const tone = actionSeverityStyle(severity)
  const statusLabel = value === 0 ? 'OK' : severity === 'critical' ? 'otevřít seznam' : 'zkontrolovat'

  return (
    <details
      style={{
        ...actionDisclosure,
        borderColor: tone.border,
        backgroundColor: tone.background,
      }}
    >
      <summary style={actionSummary}>
        <div style={{ ...actionDot, backgroundColor: tone.dot }}>!</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={actionLabel}>{label}</div>
          <div style={actionStatus}>{statusLabel}</div>
        </div>
        <div style={{ ...actionValue, color: tone.text }}>{value}</div>
      </summary>

      <div style={actionDisclosureBody}>
        {items.length === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          <div style={actionDisclosureList}>
            {items.slice(0, 6).map((item) => (
              <div key={item.id} style={actionJobLink}>
                <div style={{ minWidth: 0 }}>
                  <Link href={item.href} style={actionJobTitle}>{item.title}</Link>
                  <div style={actionJobMeta}>
                    {item.customer}
                    {item.meta ? ` • ${item.meta}` : ''}
                  </div>
                </div>
                <Link href={item.actionHref} style={actionSmallButton}>{item.actionLabel}</Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function OperationMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={operationMetric}>
      <div style={operationMetricLabel}>{label}</div>
      <div style={operationMetricValue}>{value}</div>
    </div>
  )
}

function MonthlyProfitChart({ points }: { points: ProfitChartPoint[] }) {
  const width = 640
  const height = 220
  const padding = 26
  const values = points.flatMap((point) => [point.value, point.revenue, point.costs])
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
  const getX = (index: number) => padding + index * step
  const getY = (value: number) => height - padding - ((value - min) / range) * (height - padding * 2)
  const buildPath = (key: 'value' | 'revenue' | 'costs') =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${getX(index).toFixed(1)} ${getY(point[key]).toFixed(1)}`)
      .join(' ')
  const profitPath = buildPath('value')
  const revenuePath = buildPath('revenue')
  const costsPath = buildPath('costs')
  const zeroY = getY(0)

  return (
    <div style={chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vývoj zisku v měsíci" style={chartSvg}>
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#d1d5db" strokeWidth="1" />
        <path d={revenuePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
        <path d={costsPath} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <path d={profitPath} fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) =>
          point.value === 0 && point.revenue === 0 && point.costs === 0 ? null : (
            <circle key={`${point.label}-${index}`} cx={getX(index)} cy={getY(point.value)} r="3.5" fill="#166534" />
          )
        )}
      </svg>
      <div style={chartLegend}>
        <span style={legendItem}><span style={{ ...legendDot, backgroundColor: '#166534' }} />Zisk</span>
        <span style={legendItem}><span style={{ ...legendDot, backgroundColor: '#2563eb' }} />Obrat</span>
        <span style={legendItem}><span style={{ ...legendDot, backgroundColor: '#f97316' }} />Náklady</span>
        <span>{formatCurrency(min)} až {formatCurrency(max)}</span>
      </div>
    </div>
  )
}

function JobProfitRow({
  job,
  warning,
}: {
  job: {
    id: string
    title: string
    customer: string
    profit: number
    margin: number | null
    laborCost: number
    otherCost: number
    revenue: number
  }
  warning?: string
}) {
  const tags = getJobProfitTags(job, warning)

  return (
    <Link href={`/jobs/${job.id}`} style={profitJobLink}>
      <div style={{ minWidth: 0 }}>
        <div style={profitJobTitle}>{job.title}</div>
        <div style={profitJobMeta}>{job.customer}</div>
        <div style={jobEconomyMeta}>
          Marže {formatPercent(job.margin)} | práce {formatCurrency(job.laborCost)} | ostatní {formatCurrency(job.otherCost)}
        </div>
        <div style={tagRow}>
          {tags.map((tag) => (
            <span key={tag.label} style={{ ...jobTag, ...tag.style }}>
              {tag.label}
            </span>
          ))}
        </div>
        {warning && <div style={riskReason}>{warning}</div>}
      </div>
      <div style={job.profit < 0 ? riskValue : profitValue}>{formatCurrency(job.profit)}</div>
    </Link>
  )
}

function getJobProfitTags(
  job: {
    profit: number
    margin: number | null
    laborCost: number
    otherCost: number
    revenue?: number
  },
  warning?: string
) {
  const tags: Array<{ label: string; style: CSSProperties }> = []

  if (job.profit < 0 || warning?.includes('záporný')) {
    tags.push({ label: 'Prodělává', style: tagDanger })
  }
  if (job.margin != null && job.margin <= 10) {
    tags.push({ label: 'Nízká marže', style: tagWarning })
  }
  if ((job.revenue ?? 0) <= 0) {
    tags.push({ label: 'Chybí cena', style: tagMuted })
  }
  if ((job.revenue ?? 0) > 0 && job.laborCost === 0 && job.otherCost === 0) {
    tags.push({ label: 'Chybí náklady', style: tagMuted })
  }
  if (tags.length === 0 && job.profit > 0 && (job.margin ?? 0) >= 25) {
    tags.push({ label: 'Výborná zakázka', style: tagSuccess })
  }

  return tags
}

function EconomyLine({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div style={economyLine}>
      <div style={{ ...economyLabel, fontWeight: strong ? 700 : 500 }}>{label}</div>
      <div style={{ ...economyValue, fontWeight: strong ? 800 : 700 }}>{value}</div>
    </div>
  )
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'gray' | 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'yellow'
}) {
  const toneStyle = summaryTone(tone)

  return (
    <div style={{ ...summaryPill, ...toneStyle }}>
      <div style={summaryPillLabel}>{label}</div>
      <div style={summaryPillValue}>{value}</div>
    </div>
  )
}

function summaryTone(
  tone: 'gray' | 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'yellow'
): CSSProperties {
  if (tone === 'gray') {
    return { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }
  }
  if (tone === 'blue') {
    return { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' }
  }
  if (tone === 'amber') {
    return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }
  }
  if (tone === 'red') {
    return { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
  }
  if (tone === 'green') {
    return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
  }
  if (tone === 'purple') {
    return { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }
  }
  return { backgroundColor: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }
}

function actionSeverityStyle(severity: AttentionSeverity) {
  if (severity === 'critical') {
    return {
      background: '#fef2f2',
      border: '#fecaca',
      dot: '#dc2626',
      text: '#991b1b',
    }
  }

  if (severity === 'warning') {
    return {
      background: '#fff7ed',
      border: '#fed7aa',
      dot: '#f97316',
      text: '#9a3412',
    }
  }

  return {
    background: '#f8fafc',
    border: '#e5e7eb',
    dot: '#16a34a',
    text: '#166534',
  }
}

const pageWrap: CSSProperties = {
  display: 'grid',
  gap: '10px',
  paddingBottom: '20px',
}

const heroCard: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr 0.9fr',
  gap: '18px',
  padding: '24px',
  background:
    'linear-gradient(135deg, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 100%)',
  border: '1px solid #e5e7eb',
  borderRadius: '24px',
}

const heroLeft: CSSProperties = {
  display: 'grid',
  gap: '14px',
}

const eyebrow: CSSProperties = {
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#6b7280',
  fontWeight: 700,
}

const heroTitle: CSSProperties = {
  margin: 0,
  fontSize: '42px',
  lineHeight: 1.05,
  color: '#111827',
}

const heroText: CSSProperties = {
  margin: 0,
  fontSize: '16px',
  lineHeight: 1.6,
  color: '#4b5563',
  maxWidth: '700px',
}

const heroMiniStats: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '12px',
}

const miniHeroStat: CSSProperties = {
  padding: '14px 16px',
  borderRadius: '16px',
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
}

const miniHeroLabel: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginBottom: '6px',
}

const miniHeroValue: CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
  color: '#111827',
}

const heroActions: CSSProperties = {
  display: 'grid',
  gap: '12px',
  alignContent: 'start',
}

const quickLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '9px 13px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.72)',
  color: '#0f172a',
  border: '1px solid rgba(203, 213, 225, 0.9)',
  textDecoration: 'none',
  fontWeight: 850,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.05)',
}

const quickLinkPrimary: CSSProperties = {
  ...quickLink,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  border: '1px solid rgba(255,255,255,0.34)',
  boxShadow: '0 12px 26px rgba(37, 99, 235, 0.22)',
}

const statsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '10px',
}

const kpiSection: CSSProperties = {
  display: 'grid',
  gap: '8px',
}

const kpiHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
}

const kpiTitle: CSSProperties = {
  marginTop: '2px',
  color: '#111827',
  fontSize: '18px',
  fontWeight: 850,
}

const todaySummaryCard: CSSProperties = {
  display: 'grid',
  gap: '12px',
  padding: '16px',
  borderRadius: '22px',
  background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(240,249,255,0.82))',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
}

const todaySummaryHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
}

const summaryEyebrow: CSSProperties = {
  color: '#475569',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const todaySummaryTitle: CSSProperties = {
  marginTop: '3px',
  color: '#0f172a',
  fontSize: '20px',
  fontWeight: 850,
  lineHeight: 1.2,
}

const todaySummaryCta: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '38px',
  padding: '8px 14px',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
  boxShadow: '0 12px 26px rgba(37, 99, 235, 0.18)',
}

const todaySummaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '10px',
}

const todaySummaryItem: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '10px',
  padding: '11px 12px',
  borderRadius: '16px',
  background: 'rgba(255,255,255,0.78)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
}

const todaySummaryIcon: CSSProperties = {
  width: '30px',
  height: '30px',
  borderRadius: '12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid',
}

const todaySummaryIconDot: CSSProperties = {
  width: '9px',
  height: '9px',
  borderRadius: '999px',
  boxShadow: '0 0 12px currentColor',
}

const todaySummaryIconGlyph: CSSProperties = {
  fontSize: '16px',
  lineHeight: 1,
}

const todaySummaryLabel: CSSProperties = {
  display: 'block',
  color: '#0f172a',
  fontSize: '14px',
  fontWeight: 850,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const todaySummaryHint: CSSProperties = {
  display: 'block',
  marginTop: '2px',
  color: '#64748b',
  fontSize: '12px',
  fontWeight: 700,
}

const todaySummaryValue: CSSProperties = {
  color: '#0f172a',
  fontSize: '26px',
  fontWeight: 900,
  lineHeight: 1,
}

const companyStateCardBase: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  display: 'grid',
  gap: '12px',
  padding: '18px 20px',
  borderRadius: '22px',
  border: '1px solid rgba(203, 213, 225, 0.78)',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.10)',
  backdropFilter: 'blur(18px)',
}

const companyStateCardProfit: CSSProperties = {
  ...companyStateCardBase,
  background:
    'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 46%, rgba(236,254,255,0.9) 100%)',
}

const companyStateCardLoss: CSSProperties = {
  ...companyStateCardBase,
  background:
    'linear-gradient(135deg, rgba(254,242,242,0.96) 0%, rgba(255,255,255,0.94) 52%, rgba(255,247,237,0.94) 100%)',
  border: '1px solid #fecaca',
}

const heroGlowOne: CSSProperties = {
  position: 'absolute',
  right: '-110px',
  top: '-110px',
  width: '300px',
  height: '300px',
  background: 'radial-gradient(circle, rgba(6, 182, 212, 0.28), transparent 62%)',
  filter: 'blur(10px)',
  pointerEvents: 'none',
}

const heroGlowTwo: CSSProperties = {
  position: 'absolute',
  left: '28%',
  bottom: '-150px',
  width: '360px',
  height: '240px',
  background: 'radial-gradient(circle, rgba(124, 58, 237, 0.2), transparent 66%)',
  filter: 'blur(14px)',
  pointerEvents: 'none',
}

const companyStateMain: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 420px)',
  gap: '18px',
  alignItems: 'stretch',
}

const heroLeftStack: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: '22px',
}

const heroTodayStatus: CSSProperties = {
  justifySelf: 'end',
  minWidth: '190px',
  padding: '13px 14px',
  borderRadius: '18px',
  backgroundColor: 'rgba(255, 255, 255, 0.54)',
  border: '1px solid rgba(255, 255, 255, 0.68)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  backdropFilter: 'blur(14px)',
}

const heroTodayTitle: CSSProperties = {
  color: '#334155',
  fontSize: '13px',
  fontWeight: 900,
  marginBottom: '8px',
}

const heroTodayRows: CSSProperties = {
  display: 'grid',
  gap: '6px',
  marginBottom: '10px',
}

const heroTodayLine: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 26px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '6px',
  color: '#334155',
  fontSize: '13px',
}

const heroTodayIcon: CSSProperties = {
  width: '22px',
  height: '22px',
  borderRadius: '9px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  fontSize: '12px',
  fontWeight: 950,
}

const heroTodayIconUrgent: CSSProperties = {
  ...heroTodayIcon,
  backgroundColor: '#fee2e2',
  border: '1px solid #fecaca',
  color: '#991b1b',
}

const heroTodayValue: CSSProperties = {
  color: '#0f172a',
  fontSize: '16px',
  fontWeight: 950,
}

const heroTodayValueUrgent: CSSProperties = {
  ...heroTodayValue,
  color: '#991b1b',
}

const heroTodayLabel: CSSProperties = {
  color: '#475569',
  fontWeight: 750,
  whiteSpace: 'nowrap',
}

const heroTodayButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: '32px',
  padding: '6px 10px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.76)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '12px',
  fontWeight: 900,
}

const heroPill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  marginBottom: '8px',
  padding: '5px 9px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.64)',
  border: '1px solid rgba(124, 58, 237, 0.22)',
  color: '#5b21b6',
  fontSize: '12px',
  fontWeight: 900,
  boxShadow: '0 10px 22px rgba(124, 58, 237, 0.08)',
}

const stateEyebrow: CSSProperties = {
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#475569',
  fontWeight: 900,
  marginBottom: '10px',
}

const stateTitle: CSSProperties = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.05,
  color: '#0f172a',
  maxWidth: '860px',
  fontWeight: 850,
}

const stateText: CSSProperties = {
  margin: '7px 0 0',
  fontSize: '15px',
  lineHeight: 1.45,
  color: '#475569',
  maxWidth: '850px',
}

const heroStatusRow: CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
  marginTop: '10px',
}

const heroDatePill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '30px',
  padding: '5px 10px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  color: '#334155',
  fontSize: '13px',
  fontWeight: 850,
}

const heroOkPill: CSSProperties = {
  ...heroDatePill,
  border: '1px solid #bbf7d0',
  backgroundColor: '#dcfce7',
  color: '#166534',
}

const heroProblemPill: CSSProperties = {
  ...heroDatePill,
  border: '1px solid #fecaca',
  backgroundColor: '#fee2e2',
  color: '#991b1b',
}

const stateNotesList: CSSProperties = {
  display: 'grid',
  gap: '4px',
}

const stateNumberBox: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  padding: '17px',
  borderRadius: '20px',
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
  border: '1px solid rgba(255, 255, 255, 0.74)',
  boxShadow: '0 18px 46px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255,255,255,0.8)',
  backdropFilter: 'blur(16px)',
}

const stateNumberTop: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '7px',
}

const stateNumberLabel: CSSProperties = {
  fontSize: '13px',
  fontWeight: 850,
  color: '#64748b',
}

const stateNumberBadge: CSSProperties = {
  display: 'inline-flex',
  padding: '4px 7px',
  borderRadius: '999px',
  backgroundColor: '#ecfeff',
  border: '1px solid #a5f3fc',
  color: '#0e7490',
  fontSize: '12px',
  fontWeight: 900,
}

const stateNumberProfit: CSSProperties = {
  fontSize: '36px',
  lineHeight: 1,
  fontWeight: 900,
  color: '#15803d',
}

const stateNumberLoss: CSSProperties = {
  ...stateNumberProfit,
  color: '#b91c1c',
}

const stateNumberSub: CSSProperties = {
  marginTop: '5px',
  fontSize: '12px',
  color: '#64748b',
}

const stateFooter: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
}

const monthControls: CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
}

const quickActions: CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
}

const statCard: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  padding: '14px 15px',
  borderRadius: '18px',
  background: 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(248,250,252,0.92))',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.065)',
  transition: 'transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease',
}

const highlightedStatCard: CSSProperties = {
  ...statCard,
  background: 'linear-gradient(135deg, #07111f 0%, #0f1f3f 48%, #083344 100%)',
  border: '1px solid rgba(34, 211, 238, 0.22)',
  boxShadow: '0 16px 36px rgba(15, 23, 42, 0.22)',
}

const urgentStatCard: CSSProperties = {
  ...statCard,
  background: 'linear-gradient(145deg, #fff7ed 0%, #ffffff 100%)',
  border: '1px solid rgba(251, 146, 60, 0.34)',
  boxShadow: '0 12px 26px rgba(249, 115, 22, 0.10)',
}

const statTitle: CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  marginBottom: '8px',
  fontWeight: 850,
}

const highlightedStatTitle: CSSProperties = {
  ...statTitle,
  color: '#cbd5e1',
}

const urgentStatTitle: CSSProperties = {
  ...statTitle,
  color: '#9a3412',
}

const statValue: CSSProperties = {
  fontSize: '25px',
  fontWeight: 800,
  color: '#111827',
  marginBottom: '4px',
}

const highlightedStatValue: CSSProperties = {
  ...statValue,
  color: '#ffffff',
  fontSize: '30px',
}

const urgentStatValue: CSSProperties = {
  ...statValue,
  color: '#c2410c',
}

const statSubvalue: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: 1.45,
}

const highlightedStatSubvalue: CSSProperties = {
  ...statSubvalue,
  color: '#cbd5e1',
}

const urgentStatSubvalue: CSSProperties = {
  ...statSubvalue,
  color: '#9a3412',
}

const statCardTopRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
}

const statIcon: CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: '13px',
  border: '1px solid',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const statAccent: CSSProperties = {
  position: 'absolute',
  left: '20px',
  right: '20px',
  bottom: 0,
  height: '3px',
  borderRadius: '999px 999px 0 0',
}

const statDetail: CSSProperties = {
  marginTop: '7px',
  paddingTop: '7px',
  borderTop: '1px solid rgba(226, 232, 240, 0.85)',
  color: '#94a3b8',
  fontSize: '12px',
  fontWeight: 750,
}

const highlightedStatDetail: CSSProperties = {
  ...statDetail,
  borderTop: '1px solid rgba(255,255,255,0.12)',
  color: '#93c5fd',
}

const actionStrip: CSSProperties = {
  display: 'grid',
  gap: '12px',
  padding: '16px',
  borderRadius: '22px',
  background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
}

const actionStripHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
}

const stripEyebrow: CSSProperties = {
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#64748b',
}

const stripTitle: CSSProperties = {
  marginTop: '2px',
  fontSize: '21px',
  fontWeight: 850,
  color: '#111827',
}

const stripHint: CSSProperties = {
  marginTop: '3px',
  fontSize: '12px',
  color: '#64748b',
}

const actionStripGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '10px',
  alignItems: 'stretch',
}

const attentionOkBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '7px 10px',
  borderRadius: '999px',
  backgroundColor: '#ecfdf5',
  border: '1px solid #bbf7d0',
  color: '#15803d',
  fontSize: '13px',
  fontWeight: 900,
}

const firePanel: CSSProperties = {
  display: 'grid',
  gap: '18px',
  padding: '22px',
  borderRadius: '20px',
  backgroundColor: '#ffffff',
  border: '1px solid #fecaca',
  boxShadow: '0 16px 34px rgba(127, 29, 29, 0.08)',
}

const fireEyebrow: CSSProperties = {
  fontSize: '12px',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#dc2626',
  marginBottom: '6px',
}

const fireTitle: CSSProperties = {
  margin: 0,
  fontSize: '24px',
  lineHeight: 1.2,
  color: '#111827',
}

const fireSubtitle: CSSProperties = {
  margin: '6px 0 0',
  color: '#6b7280',
  fontSize: '14px',
}

const fireGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '12px',
}

const summaryTripleGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '16px',
}

const topGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.2fr 1fr 0.9fr',
  gap: '16px',
  alignItems: 'start',
}

const bottomGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '16px',
}

const dashboardJobsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: '12px',
  alignItems: 'start',
}

const monthOverviewGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '14px',
  alignItems: 'start',
}

const compactChartPanel: CSSProperties = {
  display: 'grid',
  gap: '8px',
  minWidth: 0,
}

const jobDecisionGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '12px',
  alignItems: 'start',
}

const riskPanelWrap: CSSProperties = {
  borderRadius: '22px',
  outline: '2px solid #fed7aa',
  outlineOffset: '0',
}

const panel: CSSProperties = {
  padding: '16px',
  borderRadius: '18px',
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  minHeight: '100%',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
}

const panelHeader: CSSProperties = {
  marginBottom: '12px',
}

const panelTitle: CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
  color: '#111827',
  marginBottom: '4px',
}

const panelSubtitle: CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
}

const emptyState: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '18px',
  borderRadius: '20px',
  background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  color: '#6b7280',
}

const emptyIcon: CSSProperties = {
  width: '38px',
  height: '38px',
  borderRadius: '14px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.14))',
  color: '#2563eb',
  fontSize: '16px',
  fontWeight: 950,
}

const emptyTitle: CSSProperties = {
  color: '#0f172a',
  fontWeight: 850,
  marginBottom: '4px',
}

const emptyAction: CSSProperties = {
  display: 'inline-flex',
  marginTop: '12px',
  padding: '9px 12px',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 900,
}

const stack12: CSSProperties = {
  display: 'grid',
  gap: '12px',
}

const stack10: CSSProperties = {
  display: 'grid',
  gap: '10px',
}

const compactScrollWindow: CSSProperties = {
  maxHeight: '260px',
  overflowY: 'auto',
  paddingRight: '5px',
}

const pillBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 10px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const jobCardLink: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '74px 1fr auto',
  gap: '14px',
  alignItems: 'center',
  padding: '14px',
  borderRadius: '16px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
}

const dashboardListLink: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '14px',
  borderRadius: '16px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
}

const dashboardListTitle: CSSProperties = {
  fontWeight: 800,
  marginBottom: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dashboardListMeta: CSSProperties = {
  fontSize: '13px',
  color: '#4b5563',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dashboardListSubmeta: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginTop: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const jobTimeCol: CSSProperties = {
  display: 'grid',
  gap: '2px',
}

const jobTime: CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
}

const jobTimeMuted: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
}

const jobMainCol: CSSProperties = {
  minWidth: 0,
}

const jobTitle: CSSProperties = {
  fontWeight: 800,
  marginBottom: '4px',
}

const jobMeta: CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const jobSubmeta: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginTop: '4px',
}

const attentionRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'center',
  padding: '12px 14px',
  borderRadius: '14px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
}

const attentionLabel: CSSProperties = {
  fontWeight: 600,
}

const attentionValue: CSSProperties = {
  minWidth: '34px',
  height: '34px',
  borderRadius: '999px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#111827',
  color: '#ffffff',
  fontWeight: 800,
}

const actionRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '12px 14px',
  minHeight: '72px',
  borderRadius: '16px',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.04)',
  overflow: 'hidden',
}

const actionDisclosure: CSSProperties = {
  borderRadius: '16px',
  border: '1px solid #e5e7eb',
  color: '#111827',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.04)',
  overflow: 'hidden',
}

const actionSummary: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '12px 14px',
  cursor: 'pointer',
  listStyle: 'none',
}

const actionDisclosureBody: CSSProperties = {
  padding: '0 12px 12px',
}

const actionDisclosureList: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '8px',
  maxHeight: '320px',
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingRight: '4px',
}

const actionJobLink: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 11px',
  borderRadius: '12px',
  backgroundColor: '#ffffff',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  color: '#111827',
  textDecoration: 'none',
}

const actionJobTitle: CSSProperties = {
  fontWeight: 800,
  lineHeight: 1.25,
}

const actionJobMeta: CSSProperties = {
  marginTop: '3px',
  fontSize: '12px',
  lineHeight: 1.35,
  color: '#64748b',
  overflowWrap: 'anywhere',
}

const smallArrow: CSSProperties = {
  flexShrink: 0,
  fontSize: '12px',
  fontWeight: 800,
  color: '#334155',
}

const actionSmallButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '34px',
  padding: '7px 10px',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
  boxShadow: '0 10px 20px rgba(37, 99, 235, 0.16)',
}

const actionDot: CSSProperties = {
  width: '18px',
  height: '18px',
  borderRadius: '999px',
  flexShrink: 0,
  boxShadow: '0 0 0 5px rgba(255,255,255,0.7)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  fontSize: '12px',
  fontWeight: 950,
}

const actionLabel: CSSProperties = {
  fontWeight: 800,
  lineHeight: 1.25,
}

const actionStatus: CSSProperties = {
  marginTop: '3px',
  fontSize: '12px',
  color: '#6b7280',
}

const actionValue: CSSProperties = {
  fontSize: '26px',
  fontWeight: 900,
  minWidth: '42px',
  textAlign: 'right',
}

const operationsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px',
}

const operationsPanel: CSSProperties = {
  display: 'grid',
  gap: '12px',
  padding: '16px',
  borderRadius: '22px',
  backgroundColor: 'rgba(255,255,255,0.96)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
}

const operationsHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '14px',
  flexWrap: 'wrap',
}

const operationsSummaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '8px',
}

const monthBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '9px 12px',
  borderRadius: '999px',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#334155',
  fontSize: '13px',
  fontWeight: 800,
}

const operationsContentGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '14px',
  alignItems: 'start',
}

const operationMetric: CSSProperties = {
  padding: '10px 12px',
  borderRadius: '13px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
}

const operationMetricLabel: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginBottom: '4px',
}

const operationMetricValue: CSSProperties = {
  fontSize: '21px',
  lineHeight: 1,
  fontWeight: 900,
  color: '#111827',
}

const workerScrollArea: CSSProperties = {
  maxHeight: '420px',
  overflowY: 'auto',
  paddingRight: '4px',
}

const scrollWindow: CSSProperties = {
  maxHeight: '420px',
  overflowY: 'auto',
  paddingRight: '6px',
}

const todayWorkerList: CSSProperties = {
  display: 'grid',
  gap: '8px',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
}

const todayWorkerRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 12px',
  borderRadius: '14px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
  flexWrap: 'wrap',
}

const workerRowLink: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'center',
  padding: '12px 14px',
  borderRadius: '14px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
}

const workerName: CSSProperties = {
  fontWeight: 700,
}

const todayWorkerMeta: CSSProperties = {
  fontSize: '13px',
  color: '#4b5563',
  marginTop: '4px',
}

const todayWorkerSubmeta: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginTop: '4px',
}

const economyWrap: CSSProperties = {
  display: 'grid',
  gap: '12px',
}

const financeTable: CSSProperties = {
  display: 'grid',
  gap: '7px',
  padding: '2px',
}

const economyLine: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'center',
  paddingBottom: '7px',
  borderBottom: '1px solid #f3f4f6',
}

const economyLabel: CSSProperties = {
  color: '#4b5563',
}

const economyValue: CSSProperties = {
  color: '#111827',
}

const profitJobLink: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: '14px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  textDecoration: 'none',
  color: '#111827',
}

const monthJobRow: CSSProperties = {
  ...jobCardLink,
  gridTemplateColumns: '110px minmax(0, 1fr) auto',
}

const compactJobRow: CSSProperties = {
  ...jobCardLink,
  gridTemplateColumns: '80px minmax(0, 1fr) auto',
  padding: '10px 12px',
  borderRadius: '14px',
}

const profitJobTitle: CSSProperties = {
  fontWeight: 800,
}

const profitJobMeta: CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  marginTop: '4px',
}

const jobEconomyMeta: CSSProperties = {
  fontSize: '12px',
  color: '#4b5563',
  marginTop: '6px',
}

const riskReason: CSSProperties = {
  display: 'inline-flex',
  marginTop: '8px',
  padding: '5px 8px',
  borderRadius: '999px',
  backgroundColor: '#fff7ed',
  color: '#9a3412',
  border: '1px solid #fed7aa',
  fontSize: '12px',
  fontWeight: 700,
}

const tagRow: CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
  marginTop: '8px',
}

const jobTag: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 800,
}

const tagSuccess: CSSProperties = {
  backgroundColor: '#dcfce7',
  color: '#166534',
  border: '1px solid #bbf7d0',
}

const tagWarning: CSSProperties = {
  backgroundColor: '#fff7ed',
  color: '#9a3412',
  border: '1px solid #fed7aa',
}

const tagDanger: CSSProperties = {
  backgroundColor: '#fee2e2',
  color: '#991b1b',
  border: '1px solid #fecaca',
}

const tagMuted: CSSProperties = {
  backgroundColor: '#f1f5f9',
  color: '#475569',
  border: '1px solid #cbd5e1',
}

const profitValue: CSSProperties = {
  fontWeight: 800,
  color: '#166534',
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

const riskValue: CSSProperties = {
  ...profitValue,
  color: '#b91c1c',
}

const chartWrap: CSSProperties = {
  display: 'grid',
  gap: '10px',
}

const chartSvg: CSSProperties = {
  width: '100%',
  height: '170px',
  display: 'block',
  borderRadius: '16px',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
}

const chartLegend: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
  color: '#6b7280',
  fontSize: '12px',
}

const chartCommentBox: CSSProperties = {
  marginBottom: '12px',
  padding: '11px 13px',
  borderRadius: '14px',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#334155',
  fontSize: '14px',
  fontWeight: 700,
}

const legendItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontWeight: 700,
}

const legendDot: CSSProperties = {
  width: '9px',
  height: '9px',
  borderRadius: '999px',
  display: 'inline-block',
}

const summaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: '10px',
}

const summaryPill: CSSProperties = {
  borderRadius: '16px',
  padding: '12px 14px',
}

const summaryPillLabel: CSSProperties = {
  fontSize: '12px',
  marginBottom: '6px',
  fontWeight: 600,
}

const summaryPillValue: CSSProperties = {
  fontSize: '24px',
  fontWeight: 800,
}

const monthNavLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 12px',
  borderRadius: '11px',
  textDecoration: 'none',
  backgroundColor: '#ffffff',
  color: '#111827',
  border: '1px solid #d1d5db',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const monthInput: CSSProperties = {
  padding: '8px 12px',
  borderRadius: '11px',
  border: '1px solid #d1d5db',
  backgroundColor: '#ffffff',
  color: '#111827',
  fontWeight: 600,
}

const dayToggleWrap: CSSProperties = {
  display: 'inline-flex',
  gap: '8px',
  padding: '4px',
  borderRadius: '999px',
  backgroundColor: '#f3f4f6',
  border: '1px solid #e5e7eb',
}

const dayToggleLink: CSSProperties = {
  padding: '8px 12px',
  borderRadius: '999px',
  textDecoration: 'none',
  color: '#374151',
  fontSize: '13px',
  fontWeight: 700,
}

const dayToggleLinkActive: CSSProperties = {
  backgroundColor: '#111827',
  color: '#ffffff',
}

const weekToggleWrap: CSSProperties = {
  display: 'inline-flex',
  gap: '6px',
  padding: '4px',
  borderRadius: '999px',
  backgroundColor: '#f3f4f6',
  border: '1px solid #e5e7eb',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
}

const weekToggleLink: CSSProperties = {
  padding: '8px 12px',
  borderRadius: '999px',
  textDecoration: 'none',
  color: '#374151',
  fontSize: '13px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const weekToggleLinkActive: CSSProperties = {
  backgroundColor: '#111827',
  color: '#ffffff',
}

const hoursTableWrap: CSSProperties = {
  borderRadius: '16px',
  overflow: 'hidden',
  border: '1px solid #e5e7eb',
}

const hoursTableHeader: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr 0.8fr 0.8fr',
  gap: '12px',
  padding: '12px 14px',
  backgroundColor: '#f9fafb',
  color: '#6b7280',
  fontSize: '12px',
  fontWeight: 700,
}

const hoursTableRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr 0.8fr 0.8fr',
  gap: '12px',
  padding: '14px',
  alignItems: 'center',
  borderTop: '1px solid #f3f4f6',
}

const hoursTableNameLink: CSSProperties = {
  textDecoration: 'none',
  color: '#111827',
  fontWeight: 700,
}

const hoursTableMuted: CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginTop: '4px',
}
