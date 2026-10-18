import { companyPayrollQuery, readPayrollRows, readPayrollAssignments, readActivePayrollMember } from '@/lib/dal/payroll-readers'
import { readAdvanceSettings } from '@/lib/dal/advance-settings'
import { readPayrollAdvanceLedger } from '@/lib/dal/worker-advances'
import { formatAdvanceMoney, payrollAdvanceTotal } from '@/lib/payroll/advances'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import DashboardShell from '@/components/DashboardShell'
import WorkerAdvancesSection from '@/app/workers/[workerId]/WorkerAdvancesSection'
import WorkerAssignmentsSection from '@/app/workers/[workerId]/WorkerAssignmentsSection'
import WorkerInvitePanel from '@/app/workers/[workerId]/WorkerInvitePanel'
import WorkerShiftsSection from '@/app/workers/[workerId]/WorkerShiftsSection'
import WorkerSummaryStats from '@/app/workers/[workerId]/WorkerSummaryStats'
import {
  type AdvanceRequestPayrollRow,
  type CompanyMemberRow,
  type JobRelation,
  type PayrollItemRow,
  type ProfileRow,
  type ShiftJobOption,
  type WorkShiftRow,
  type WorkerAdvanceRow,
  type WorkerDetailPageProps,
  type WorkerJobAssignmentSummaryRow,
  boxStyle,
  formatDate,
  formatHours,
  getAdvanceRange,
  getEffectiveAssignmentHours,
  getEffectiveShiftHours,
  getTodayMonthString,
  getWorkMonthRange,
  doesDateRangeOverlap,
  getWorkerName,
  getEffectiveAssignmentRate,
  getEffectiveAssignmentReward,
  isMissingWorkShiftAssignmentColumn,
  isValidMonthString,
  monthNavButtonStyle,
  normalizeJobAssignments,
  sectionTitleStyle,
  shiftMonth,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
import { requireCompanyRole, requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  getContractorBillingTypeLabel,
  getWorkerType,
  getWorkerTypeLabel,
} from '@/lib/payroll-settings'
import { calculateWorkerPayroll } from '@/lib/payroll/worker-payroll'
import {
  SecondaryAction,
  actionRowStyle,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroTextStyle,
  heroTitleStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  pageShellStyle,
  primaryButtonStyle,
  sectionCardStyle,
  secondaryButtonStyle,
} from '@/components/SaasPageLayout'

type AbsenceRow = {
  id: string
  profile_id: string | null
  absence_mode: string | null
  absence_type: string | null
  start_at: string | null
  end_at: string | null
  note: string | null
  status: string | null
  created_at: string | null
  reviewed_at: string | null
}

type AdvanceRequestStatus = 'pending' | 'approved' | 'rejected' | 'paid'
type AbsenceRequestStatus = 'pending' | 'approved' | 'rejected'

type PayrollPaymentRow = {
  id: string
  profile_id: string | null
  payroll_month: string | null
  amount: number | string | null
  paid_at: string | null
}

type LatestWorkerInviteRow = {
  id: string
  status: string | null
  expires_at: string | null
}

function isMissingPayrollPaymentsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message ?? '').toLowerCase()
  return (error?.code === '42P01' || error?.code === 'PGRST205') && message.includes('payroll_payments')
}

function renderError(message: string) {
  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <div style={errorStateStyle}>
          {message}
        </div>
      </main>
    </DashboardShell>
  )
}

function renderNotFound(message: string) {
  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <div style={emptyStateStyle}>
          {message}
        </div>
      </main>
    </DashboardShell>
  )
}

function getAbsenceTypeLabel(absence: Pick<AbsenceRow, 'absence_mode' | 'absence_type'>) {
  if (absence.absence_type === 'sick' || absence.absence_mode === 'sick') {
    return 'Nemoc'
  }

  return 'Nahlášená nepřítomnost'
}

function getAbsenceBadgeStyle(absence: Pick<AbsenceRow, 'absence_mode' | 'absence_type'>) {
  if (absence.absence_type === 'sick' || absence.absence_mode === 'sick') {
    return {
      backgroundColor: '#fee2e2',
      color: '#b91c1c',
      border: '1px solid #fecaca',
    }
  }

  return {
    backgroundColor: '#ffedd5',
    color: '#c2410c',
    border: '1px solid #fdba74',
  }
}

function getAdvanceRequestStatus(request: AdvanceRequestPayrollRow): AdvanceRequestStatus {
  const normalized = (request.status ?? '').trim().toLowerCase()

  if (normalized === 'paid' || request.paid_at) return 'paid'
  if (normalized === 'rejected') return 'rejected'
  if (normalized === 'approved' || request.approved_at) return 'approved'

  return 'pending'
}

function getAbsenceRequestStatus(absence: Pick<AbsenceRow, 'status'>): AbsenceRequestStatus {
  if (absence.status === 'approved') return 'approved'
  if (absence.status === 'rejected') return 'rejected'
  return 'pending'
}

function getRequestStatusLabel(status: AdvanceRequestStatus | AbsenceRequestStatus) {
  if (status === 'paid') return 'Vyplaceno'
  if (status === 'approved') return 'Schváleno'
  if (status === 'rejected') return 'Zamítnuto'
  return 'Čeká na schválení'
}

function getRequestStatusBadgeStyle(status: AdvanceRequestStatus | AbsenceRequestStatus) {
  if (status === 'paid') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (status === 'approved') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  if (status === 'rejected') {
    return {
      backgroundColor: '#fee2e2',
      color: '#b91c1c',
      border: '1px solid #fecaca',
    }
  }

  return {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fde68a',
  }
}

function getAdvanceRequestAmount(request: AdvanceRequestPayrollRow) {
  const amount = Number(request.amount ?? request.requested_amount ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function getAdvanceRequestRequestedAmount(request: AdvanceRequestPayrollRow) {
  const amount = Number(request.requested_amount ?? request.amount ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

export default async function WorkerDetailPage({ params, searchParams }: WorkerDetailPageProps) {
  const pageAccess = await requireWorkerAccess()
  if (!pageAccess.ok || !['company_admin', 'super_admin'].includes(pageAccess.value.role ?? '')) return renderError('K financím pracovníka nemáte přístup.')
  const dictionary = await getRequestDictionary()
  const locale = await getRequestLocale()
  const { workerId } = await params
  const supabase = await createSupabaseServerClient()
  const memberResponse = await readActivePayrollMember(supabase, pageAccess.value.companyId, workerId)
  if (memberResponse.error) return renderError(dictionary.workers.detail.loadMembersFailed)
  if (!memberResponse.data) return renderNotFound(dictionary.workers.detail.workerNotFound)
  const companyMember = memberResponse.data as CompanyMemberRow
  let advanceSettings: Awaited<ReturnType<typeof readAdvanceSettings>>
  try { advanceSettings = await readAdvanceSettings(supabase, pageAccess.value.companyId, workerId) }
  catch { return renderError('Výplatní nastavení aktivní firmy se nepodařilo načíst.') }
  const formatCurrency = (value: number) => formatAdvanceMoney(value, advanceSettings.currency)
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const selectedMonth = isValidMonthString(resolvedSearchParams?.month)
    ? (resolvedSearchParams?.month ?? getTodayMonthString())
    : getTodayMonthString()

  const {
    workStartDate,
    workEndExclusiveDate,
    workStartIso,
    workEndExclusiveIso,
    workPeriodLabel,
  } = getWorkMonthRange(selectedMonth)

  const {
    payDateLabel,
    advancePeriodLabel,
    monthLabel,
  } = getAdvanceRange(selectedMonth, advanceSettings.payType === 'monthly' ? advanceSettings.payday : null)

  const previousMonth = shiftMonth(selectedMonth, -1)
  const nextMonth = shiftMonth(selectedMonth, 1)


  const profileResponse = await supabase
    .from('profiles')
    .select(`
      id,
      full_name,
      email,
      phone,
      worker_status,
      activated_at,
      disabled_at,
      last_seen_at,
      device_registered_at,
      default_hourly_rate,
      advance_paid,
      worker_type,
      use_custom_payroll,
      custom_payroll_type,
      custom_payroll_day_of_month,
      custom_payroll_weekday,
      custom_payroll_anchor_date,
      allow_advances_override,
      advance_limit_amount_override,
      contractor_billing_type,
      contractor_default_rate
    `)
    .eq('id', workerId)
    .maybeSingle()

  if (profileResponse.error) {
    return renderError(`${dictionary.workers.detail.loadWorkerFailed}: ${profileResponse.error.message}`)
  }

  const profile = profileResponse.data as ProfileRow | null
  if (!profile) return renderNotFound(dictionary.workers.detail.workerNotFound)

  const [
    assignmentResponses,
    workerAdvancesResponse,
    advanceRequestsResponse,
    payrollItemsResponse,
    absencesResponse,
  ] =
    await Promise.all([
      readPayrollAssignments(supabase, pageAccess.value.companyId, [workerId], `
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
          jobs!inner (
            id,
            company_id,
            title,
            address,
            status,
            start_at,
            end_at,
            price,
            is_paid,
            customers (
              name
            )
          )
        `),
      readPayrollAdvanceLedger(supabase, pageAccess.value.companyId, { profileId: workerId, payrollMonth: `${selectedMonth}-01`, currency: advanceSettings.currency }),
      readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'advance_requests', 'id, profile_id, amount, requested_amount, reason, note, status, requested_at, approved_at, reviewed_at, paid_at, payroll_month')
        .eq('profile_id', workerId)
        .order('requested_at', { ascending: false }).order('id')),
      readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'payroll_items', 'id, profile_id, payroll_month, item_type, amount, note, created_at')
        .eq('profile_id', workerId)
        .eq('payroll_month', selectedMonth)
        .order('created_at', { ascending: false }).order('id')),
      readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'absence_requests', 'id, profile_id, absence_mode, absence_type, start_at, end_at, note, status, created_at, reviewed_at')
        .eq('profile_id', workerId)
        .order('start_at', { ascending: false }).order('id')),
    ])

  const jobAssignmentsResponse = assignmentResponses.assignments
  const workerJobAssignmentSummaryResponse = assignmentResponses.summaries

  if (jobAssignmentsResponse.error) {
    return renderError(`${dictionary.workers.detail.loadAssignmentsFailed}: ${jobAssignmentsResponse.error.message}`)
  }

  if (workerJobAssignmentSummaryResponse.error) {
    return renderError(
      `${dictionary.workers.detail.loadSummaryFailed}: ${workerJobAssignmentSummaryResponse.error.message}`,
    )
  }

  if (workerAdvancesResponse.error) {
    return renderError(`${dictionary.workers.detail.loadAdvancesFailed}: ${workerAdvancesResponse.error.message}`)
  }

  if (advanceRequestsResponse.error) {
    return renderError(`${dictionary.workers.detail.loadAdvancesFailed}: ${advanceRequestsResponse.error.message}`)
  }

  if (payrollItemsResponse.error) {
    return renderError(`${dictionary.workers.detail.loadPayrollItemsFailed}: ${payrollItemsResponse.error.message}`)
  }

  if (absencesResponse.error) {
    return renderError(`Nepodařilo se načíst nepřítomnosti: ${absencesResponse.error.message}`)
  }

  let workShiftsSupportJobAssignment = true
  let workShiftsData: Array<Partial<WorkShiftRow>> | null = null
  let workShiftsError: { message: string } | null = null

  const workShiftsWithJobResponse = await readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'work_shifts', 'id, profile_id, company_id, job_id, job_hours_override, shift_date, started_at, ended_at, hours_override, note')
    .eq('profile_id', workerId)
    .gte('shift_date', workStartDate)
    .lt('shift_date', workEndExclusiveDate)
    .order('started_at', { ascending: false }).order('id'))

  if (
    workShiftsWithJobResponse.error &&
    isMissingWorkShiftAssignmentColumn(workShiftsWithJobResponse.error.message)
  ) {
    workShiftsSupportJobAssignment = false

    const fallbackWorkShiftsResponse = await readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'work_shifts', 'id, profile_id, company_id, shift_date, started_at, ended_at, hours_override, note')
      .eq('profile_id', workerId)
      .gte('shift_date', workStartDate)
      .lt('shift_date', workEndExclusiveDate)
      .order('started_at', { ascending: false }).order('id'))

    workShiftsData = (fallbackWorkShiftsResponse.data ?? []) as Array<Partial<WorkShiftRow>>
    workShiftsError = fallbackWorkShiftsResponse.error
  } else {
    workShiftsData = (workShiftsWithJobResponse.data ?? []) as Array<Partial<WorkShiftRow>>
    workShiftsError = workShiftsWithJobResponse.error
  }

  if (workShiftsError) {
    return renderError(`${dictionary.workers.shiftsLoadError}: ${workShiftsError.message}`)
  }

  const allJobAssignments = normalizeJobAssignments((jobAssignmentsResponse.data ?? []) as unknown[])
  const workerJobAssignmentSummaries =
    ((workerJobAssignmentSummaryResponse.data ?? []) as WorkerJobAssignmentSummaryRow[]).map((item) => ({
      assignment_id: item.assignment_id,
      job_id: item.job_id,
      profile_id: item.profile_id,
      labor_hours_total: item.labor_hours_total != null ? Number(item.labor_hours_total) : null,
      effective_hourly_rate:
        item.effective_hourly_rate != null ? Number(item.effective_hourly_rate) : null,
      labor_cost_total: item.labor_cost_total != null ? Number(item.labor_cost_total) : null,
    }))

  const workerJobAssignmentSummaryMap = new Map(
    workerJobAssignmentSummaries.map((item) => [item.assignment_id, item]),
  )

  const assignmentJobIds = Array.from(
    new Set(
      allJobAssignments
        .map((item) => item.job_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )

  const jobStatesResponse =
    assignmentJobIds.length > 0
      ? await readPayrollRows(supabase.from('jobs_with_state').select('id, time_state, work_state').in('id', assignmentJobIds).order('id'))
      : { data: [], error: null }

  if (jobStatesResponse.error) {
    return renderError(`${dictionary.workers.detail.loadJobsStateFailed}: ${jobStatesResponse.error.message}`)
  }

  const jobStateMap = new Map(
    ((jobStatesResponse.data ?? []) as Array<{ id: string; time_state: string | null; work_state: string | null }>).map(
      (item) => [item.id, { time_state: item.time_state, work_state: item.work_state }],
    ),
  )

  const mergedJobAssignments = allJobAssignments.map((assignment) => ({
    ...assignment,
    effective_hours:
      assignment.id && workerJobAssignmentSummaryMap.has(assignment.id)
        ? (workerJobAssignmentSummaryMap.get(assignment.id)?.labor_hours_total ?? null)
        : null,
    effective_rate:
      assignment.id && workerJobAssignmentSummaryMap.has(assignment.id)
        ? (workerJobAssignmentSummaryMap.get(assignment.id)?.effective_hourly_rate ?? null)
        : null,
    effective_reward:
      assignment.id && workerJobAssignmentSummaryMap.has(assignment.id)
        ? (workerJobAssignmentSummaryMap.get(assignment.id)?.labor_cost_total ?? null)
        : null,
    jobs: assignment.jobs
      ? {
          ...assignment.jobs,
          time_state: jobStateMap.get(assignment.jobs.id)?.time_state ?? null,
          work_state: jobStateMap.get(assignment.jobs.id)?.work_state ?? null,
        }
      : null,
  }))

  const workLogs: Array<{
    job_id: string | null
    work_date: string | null
    jobs: JobRelation | null
    hours: number | null
  }> = []

  const workShifts = ((workShiftsData ?? []) as Array<Partial<WorkShiftRow>>).map((item) => ({
    id: item.id ?? '',
    profile_id: item.profile_id ?? null,
    company_id: item.company_id ?? null,
    job_id: item.job_id ?? null,
    job_hours_override: item.job_hours_override ?? null,
    shift_date: item.shift_date ?? null,
    started_at: item.started_at ?? null,
    ended_at: item.ended_at ?? null,
    hours_override: item.hours_override ?? null,
    note: item.note ?? null,
  }))

  const workerAdvances = ((workerAdvancesResponse.data ?? []) as unknown[]) as WorkerAdvanceRow[]
  const allAdvanceRequests = ((advanceRequestsResponse.data ?? []) as unknown[]) as AdvanceRequestPayrollRow[]
  const advanceRequestsForPeriod = allAdvanceRequests
  const displayedWorkerAdvances = [...workerAdvances].sort((a, b) => {
    const aTime = a.issued_at ? new Date(a.issued_at).getTime() : 0
    const bTime = b.issued_at ? new Date(b.issued_at).getTime() : 0
    return bTime - aTime
  })
  const absenceRequests = (((absencesResponse.data ?? []) as unknown[]) as AbsenceRow[]).filter((absence) =>
    doesDateRangeOverlap(
      absence.start_at,
      absence.end_at ?? absence.start_at,
      workStartIso,
      workEndExclusiveIso,
    ),
  )
  const approvedAbsences = absenceRequests.filter((absence) => getAbsenceRequestStatus(absence) === 'approved')
  const latestInviteResponse = companyMember?.company_id
    ? await supabase
        .from('worker_invites')
        .select('id, status, expires_at')
        .eq('company_id', companyMember.company_id)
        .eq('worker_profile_id', workerId)
        .order('created_at', { ascending: false })
        .limit(1)
    : { data: [], error: null }

  if (latestInviteResponse.error) {
    return renderError(`Nepodařilo se načíst pozvánku pracovníka: ${latestInviteResponse.error.message}`)
  }

  const latestInvite = (((latestInviteResponse.data ?? []) as unknown[]) as LatestWorkerInviteRow[])[0] ?? null
  const payrollPaymentResponse = companyMember?.company_id
    ? await supabase
        .from('payroll_payments')
        .select('id, profile_id, payroll_month, amount, paid_at')
        .eq('company_id', companyMember.company_id)
        .eq('profile_id', workerId)
        .eq('payroll_month', selectedMonth)
        .maybeSingle()
    : { data: null, error: null }

  if (payrollPaymentResponse.error && !isMissingPayrollPaymentsTable(payrollPaymentResponse.error)) {
    return renderError(`Nepodařilo se načíst stav výplaty: ${payrollPaymentResponse.error.message}`)
  }

  const payrollPayment = payrollPaymentResponse.error
    ? null
    : (payrollPaymentResponse.data as PayrollPaymentRow | null)

  const workerType = getWorkerType(profile)
  const isContractor = workerType === 'contractor'

  const shiftCompanyId = pageAccess.value.companyId

  const shiftLinkedJobIds = new Set(
    workShifts
      .map((item) => item.job_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )

  const shiftJobsResponse =
    shiftCompanyId && workShiftsSupportJobAssignment
      ? await readPayrollRows(companyPayrollQuery(supabase, pageAccess.value.companyId, 'jobs', 'id, title, start_at, end_at')
          .eq('company_id', shiftCompanyId)
          .order('start_at', { ascending: false }).order('id'))
      : { data: [], error: null }

  if (shiftCompanyId && shiftJobsResponse.error) {
    return renderError(`${dictionary.workers.detail.loadShiftJobsFailed}: ${shiftJobsResponse.error.message}`)
  }

  const shiftJobs = ((shiftJobsResponse.data ?? []) as ShiftJobOption[]).filter((job) => {
    const overlapsSelectedMonth = doesDateRangeOverlap(
      job.start_at ?? null,
      job.end_at ?? null,
      workStartIso,
      workEndExclusiveIso,
    )

    return overlapsSelectedMonth || shiftLinkedJobIds.has(job.id)
  })
  const shiftJobsMap = new Map(
    shiftJobs.map((job) => [job.id, job.title ?? dictionary.workers.detail.unnamedJob]),
  )
  const now = new Date()
  const latestInviteExpired =
    latestInvite?.status === 'pending' &&
    latestInvite.expires_at != null &&
    new Date(latestInvite.expires_at).getTime() <= now.getTime()
  const workerInviteStatus =
    profile.worker_status === 'disabled' || profile.disabled_at
      ? 'disabled'
      : profile.activated_at || profile.worker_status === 'active'
        ? 'active'
        : latestInviteExpired
          ? 'expired'
          : latestInvite?.status ?? profile.worker_status ?? 'not_invited'

  const jobAssignments = mergedJobAssignments.filter((item) => {
    const overlapsByJobRange = doesDateRangeOverlap(
      item.jobs?.start_at ?? null,
      item.jobs?.end_at ?? null,
      workStartIso,
      workEndExclusiveIso,
    )

    const overlapsByWorkRange = doesDateRangeOverlap(
      item.work_started_at ?? null,
      item.work_completed_at ?? null,
      workStartIso,
      workEndExclusiveIso,
    )

    const hasShiftInMonth = workShifts.some((shift) => shift.job_id != null && shift.job_id === item.job_id)

    return overlapsByJobRange || overlapsByWorkRange || hasShiftInMonth
  })

  const totalShiftHours = workShifts.reduce((sum, item) => sum + getEffectiveShiftHours(item), 0)
  const defaultHourlyRate = Number(
    isContractor
      ? profile.contractor_default_rate ?? profile.default_hourly_rate ?? 0
      : profile.default_hourly_rate ?? 0,
  )
  const totalJobHours = jobAssignments.reduce((sum, item) => sum + getEffectiveAssignmentHours(item), 0)
  const totalStandaloneShiftHours = Math.max(0, totalShiftHours - totalJobHours)
  const assignmentRateByJobId = new Map<string, number>()
  for (const assignment of jobAssignments) {
    if (!assignment.job_id) continue
    assignmentRateByJobId.set(assignment.job_id, getEffectiveAssignmentRate(assignment, defaultHourlyRate))
  }
  const shiftReward = workShifts.reduce((sum, shift) => {
    const shiftRate = shift.job_id ? assignmentRateByJobId.get(shift.job_id) ?? defaultHourlyRate : defaultHourlyRate
    return sum + getEffectiveShiftHours(shift) * shiftRate
  }, 0)
  const customerCoveredReward = jobAssignments.reduce(
    (sum, item) => sum + getEffectiveAssignmentReward(item, defaultHourlyRate, profile),
    0,
  )
  const companyCoveredReward = totalStandaloneShiftHours * defaultHourlyRate
  const advancePaidInPeriod = payrollAdvanceTotal(workerAdvancesResponse.data, workerAdvancesResponse.settlements)
  const payrollItems = ((payrollItemsResponse.data ?? []) as unknown[]) as PayrollItemRow[]
  const payrollBonusTotal = payrollItems
    .filter((item) => item.item_type === 'bonus')
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
  const payrollMealTotal = payrollItems
    .filter((item) => item.item_type === 'meal')
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
  const payrollDeductionTotal = payrollItems
    .filter((item) => item.item_type === 'deduction')
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
  const payroll = calculateWorkerPayroll({
    worker: profile,
    jobReward: customerCoveredReward,
    shiftReward,
    bonusTotal: payrollBonusTotal,
    mealTotal: payrollMealTotal,
    deductionTotal: payrollDeductionTotal,
    advanceTotal: advancePaidInPeriod,
  })
  const totalRewardAfterAdvance = payroll.netPayout

  async function createWorkerShift(formData: FormData) {
    'use server'

    const profileId = String(formData.get('profileId') ?? '').trim()
    const companyId = String(formData.get('companyId') ?? '').trim()
    const month = String(formData.get('month') ?? '').trim()
    const shiftDate = String(formData.get('shift_date') ?? '').trim()
    const startedAtRaw = String(formData.get('started_at') ?? '').trim()
    const endedAtRaw = String(formData.get('ended_at') ?? '').trim()
    const jobId = String(formData.get('job_id') ?? '').trim()
    const jobHoursRaw = String(formData.get('job_hours_override') ?? '').trim()
    const hoursRaw = String(formData.get('hours_override') ?? '').trim()
    const note = String(formData.get('note') ?? '').trim()

    const targetUrl = profileId
      ? `/workers/${profileId}${month ? `?month=${encodeURIComponent(month)}` : ''}`
      : '/workers'

    if (!profileId || !shiftDate) {
      redirect(targetUrl)
    }

    const access = await requireCompanyRole('company_admin', 'super_admin')

    if (!access.ok || companyId !== access.value.companyId) {
      redirect(targetUrl)
    }

    const startedAtDate = startedAtRaw ? new Date(startedAtRaw) : null
    const endedAtDate = endedAtRaw ? new Date(endedAtRaw) : null
    const startedAt = startedAtDate && !Number.isNaN(startedAtDate.getTime()) ? startedAtDate.toISOString() : null
    const endedAt = endedAtDate && !Number.isNaN(endedAtDate.getTime()) ? endedAtDate.toISOString() : null
    const hoursOverride = hoursRaw ? Number(hoursRaw.replace(',', '.')) : null
    const parsedJobHours = jobHoursRaw ? Number(jobHoursRaw.replace(',', '.')) : null

    if (
      (startedAtRaw !== '' && !startedAt) ||
      (endedAtRaw !== '' && !endedAt) ||
      (hoursRaw && (hoursOverride == null || Number.isNaN(hoursOverride))) ||
      (jobHoursRaw && (parsedJobHours == null || Number.isNaN(parsedJobHours)))
    ) {
      redirect(targetUrl)
    }

    const calculatedHours =
      startedAtDate && endedAtDate && endedAtDate.getTime() > startedAtDate.getTime()
        ? Math.round(((endedAtDate.getTime() - startedAtDate.getTime()) / 1000 / 60 / 60) * 100) / 100
        : null
    const jobHoursOverride = jobId ? parsedJobHours ?? hoursOverride ?? calculatedHours : null

    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.from('work_shifts').insert({
      profile_id: profileId,
      company_id: access.value.companyId,
      job_id: jobId || null,
      job_hours_override: jobId ? jobHoursOverride : null,
      shift_date: shiftDate,
      started_at: startedAt,
      ended_at: endedAt,
      hours_override: hoursOverride,
      note: note || 'Vytvořeno ručně v administraci',
    })

    if (error) {
      redirect(targetUrl)
    }

    redirect(targetUrl)
  }

  async function markPayrollPaid(formData: FormData) {
    'use server'

    const profileId = String(formData.get('profileId') ?? '').trim()
    const month = String(formData.get('month') ?? '').trim()
    const amount = Number(formData.get('amount') ?? 0)
    const targetUrl = profileId
      ? `/workers/${profileId}${month ? `?month=${encodeURIComponent(month)}` : ''}`
      : '/workers'

    if (!profileId || !isValidMonthString(month) || !Number.isFinite(amount)) {
      redirect(targetUrl)
    }

    const access = await requireCompanyRole('company_admin', 'super_admin')
    if (!access.ok) redirect(targetUrl)

    const supabase = await createSupabaseServerClient()
    const memberResponse = await supabase
      .from('company_members')
      .select('id')
      .eq('company_id', access.value.companyId)
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .maybeSingle()

    if (memberResponse.error || !memberResponse.data) redirect(targetUrl)

    await supabase
      .from('payroll_payments')
      .upsert(
        {
          company_id: access.value.companyId,
          profile_id: profileId,
          payroll_month: month,
          amount: Math.round(amount * 100) / 100,
          status: 'paid',
          paid_at: new Date().toISOString(),
          paid_by: access.value.profileId,
        },
        { onConflict: 'company_id,profile_id,payroll_month' },
      )

    revalidatePath('/workers')
    revalidatePath(`/workers/${profileId}`)
    redirect(targetUrl)
  }

  async function unmarkPayrollPaid(formData: FormData) {
    'use server'

    const profileId = String(formData.get('profileId') ?? '').trim()
    const month = String(formData.get('month') ?? '').trim()
    const targetUrl = profileId
      ? `/workers/${profileId}${month ? `?month=${encodeURIComponent(month)}` : ''}`
      : '/workers'

    if (!profileId || !isValidMonthString(month)) {
      redirect(targetUrl)
    }

    const access = await requireCompanyRole('company_admin', 'super_admin')
    if (!access.ok) redirect(targetUrl)

    const supabase = await createSupabaseServerClient()
    await supabase
      .from('payroll_payments')
      .delete()
      .eq('company_id', access.value.companyId)
      .eq('profile_id', profileId)
      .eq('payroll_month', month)

    revalidatePath('/workers')
    revalidatePath(`/workers/${profileId}`)
    redirect(targetUrl)
  }

  async function deleteWorker(formData: FormData) {
    'use server'

    const profileId = String(formData.get('profileId') ?? '').trim()
    const confirmed = formData.get('confirmDelete') === 'on'

    if (!profileId || !confirmed) {
      redirect(profileId ? `/workers/${profileId}` : '/workers')
    }

    const access = await requireCompanyRole('company_admin', 'super_admin')
    if (!access.ok) {
      redirect(`/workers/${profileId}`)
    }

    const supabase = await createSupabaseServerClient()
    const memberResponse = await supabase
      .from('company_members')
      .select('id')
      .eq('company_id', access.value.companyId)
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .maybeSingle()

    if (memberResponse.error || !memberResponse.data?.id) {
      redirect(`/workers/${profileId}`)
    }

    const nowIso = new Date().toISOString()
    const profileUpdateResponse = await supabase
      .from('profiles')
      .update({
        worker_status: 'disabled',
        disabled_at: nowIso,
      })
      .eq('id', profileId)

    if (profileUpdateResponse.error) {
      redirect(`/workers/${profileId}`)
    }

    await supabase
      .from('worker_invites')
      .update({
        status: 'revoked',
        revoked_at: nowIso,
      })
      .eq('company_id', access.value.companyId)
      .eq('worker_profile_id', profileId)
      .eq('status', 'pending')

    const memberUpdateResponse = await supabase
      .from('company_members')
      .update({ is_active: false })
      .eq('id', memberResponse.data.id)
      .eq('company_id', access.value.companyId)

    if (memberUpdateResponse.error) {
      redirect(`/workers/${profileId}`)
    }

    revalidatePath('/workers')
    revalidatePath(`/workers/${profileId}`)
    redirect('/workers')
  }

  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <SecondaryAction href={`/workers?month=${selectedMonth}`}>
          {dictionary.workers.detail.backToWorkers}
        </SecondaryAction>

        <section data-tour="worker-detail-header" style={heroCardStyle}>
          <div style={{ display: 'grid', gap: '16px', minWidth: 0, flex: '1 1 520px' }}>
            <div>
              <div style={eyebrowStyle}>Tým</div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '22px',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 55%, #06b6d4 100%)',
                    color: '#ffffff',
                    fontSize: '22px',
                    fontWeight: 900,
                    boxShadow: '0 18px 34px rgba(37,99,235,0.22)',
                  }}
                >
                  {getWorkerName(profile)
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1 style={heroTitleStyle}>{getWorkerName(profile)}</h1>
                  <p style={{ ...heroTextStyle, marginTop: '8px' }}>
                    {profile.email ?? 'E-mail není vyplněný'}
                  </p>
                  <div style={{ marginTop: '10px', display: 'inline-flex', borderRadius: '999px', padding: '7px 11px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: '12px', fontWeight: 900 }}>
                    {getWorkerTypeLabel(profile.worker_type)}
                  </div>
                </div>
              </div>
              {isContractor ? (
                <p style={{ ...heroTextStyle, fontSize: '15px' }}>
                  Externí pracovník se nepočítá do klasické výplaty ani záloh. Náklady se vedou jako externí práce u zakázek.
                </p>
              ) : (
                <p style={{ ...heroTextStyle, fontSize: '15px' }}>
                  {dictionary.workers.workingMonth}: {workPeriodLabel}. {dictionary.workers.advancesForPayroll}: {advancePeriodLabel}. Plán výplaty podle současného nastavení: {advanceSettings.payType === 'monthly' ? payDateLabel : 'Podle výplatního režimu'}.
                </p>
              )}
            </div>

            <div style={actionRowStyle}>
              <Link href={`/workers/${workerId}?month=${previousMonth}`} style={monthNavButtonStyle}>
                {dictionary.workers.detail.previousPayroll}
              </Link>
              <div
                style={{
                  ...primaryButtonStyle,
                  minHeight: '40px',
                  boxShadow: '0 12px 24px rgba(37, 99, 235, 0.18)',
                }}
              >
                {monthLabel}
              </div>
              <Link href={`/workers/${workerId}?month=${nextMonth}`} style={monthNavButtonStyle}>
                {dictionary.workers.detail.nextPayroll}
              </Link>
              <Link href={`/workers/${workerId}?month=${getTodayMonthString()}`} style={monthNavButtonStyle}>
                {dictionary.workers.detail.currentPayroll}
              </Link>
            </div>
          </div>

          <div
            data-tour="worker-detail-payroll"
            style={{
              ...sectionCardStyle,
              flex: '0 1 320px',
              background: 'rgba(255,255,255,0.74)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div style={{ ...metaLabelStyle, marginBottom: '8px' }}>
              {isContractor ? 'Vyúčtování subdodavatele' : 'Výplata po zálohách'}
            </div>
            <div style={{ fontSize: '34px', lineHeight: 1.05, fontWeight: 900, color: '#047857' }}>
              {formatCurrency(totalRewardAfterAdvance)}
            </div>
            <div style={{ marginTop: '8px', color: '#64748b', fontSize: '14px' }}>
              {payroll.baseSource === 'job'
                ? `Úkolově podle zakázek ${formatCurrency(customerCoveredReward)}, evidované směny ${formatHours(totalShiftHours)} h, zálohy ${formatCurrency(advancePaidInPeriod)}.`
                : `Směny ${formatHours(totalShiftHours)} h (${formatCurrency(shiftReward)}), zakázky ${formatHours(totalJobHours)} h jen pro rozpad nákladů, zálohy ${formatCurrency(advancePaidInPeriod)}.`}
            </div>
            <div
              style={{
                marginTop: '12px',
                display: 'inline-flex',
                borderRadius: '999px',
                padding: '7px 11px',
                fontSize: '12px',
                fontWeight: 900,
                backgroundColor: payrollPayment?.paid_at ? '#dcfce7' : '#fff7ed',
                color: payrollPayment?.paid_at ? '#166534' : '#9a3412',
              }}
            >
              {payrollPayment?.paid_at ? `Uhrazeno ${formatDate(payrollPayment.paid_at)}` : 'Čeká na úhradu'}
            </div>
            <Link
              href={`/workers/${workerId}/finance/edit?month=${selectedMonth}`}
              style={{ ...primaryButtonStyle, marginTop: '16px', width: '100%', boxSizing: 'border-box' }}
            >
              {dictionary.workers.detail.editWorker}
            </Link>
            {payrollPayment?.paid_at ? (
              <form action={unmarkPayrollPaid} style={{ marginTop: '10px' }}>
                <input type="hidden" name="profileId" value={workerId} />
                <input type="hidden" name="month" value={selectedMonth} />
                <button type="submit" style={{ ...secondaryButtonStyle, width: '100%' }}>
                  Zrušit uhrazení výplaty
                </button>
              </form>
            ) : (
              <form action={markPayrollPaid} style={{ marginTop: '10px' }}>
                <input type="hidden" name="profileId" value={workerId} />
                <input type="hidden" name="month" value={selectedMonth} />
                <input type="hidden" name="amount" value={String(totalRewardAfterAdvance)} />
                <button type="submit" style={{ ...primaryButtonStyle, width: '100%' }}>
                  Označit výplatu jako uhrazenou
                </button>
              </form>
            )}
          </div>
        </section>

        <details style={sectionCardStyle}>
          <summary
            style={{
              ...primaryButtonStyle,
              width: 'fit-content',
              cursor: 'pointer',
              listStyle: 'none',
            }}
          >
            Pozvat pracovníka
          </summary>
          <div style={{ marginTop: '16px' }}>
            <WorkerInvitePanel
              workerId={workerId}
              workerName={getWorkerName(profile)}
              phone={profile.phone ?? null}
              email={profile.email ?? null}
              locale={locale}
              framed={false}
              initialInvite={{
                inviteId: latestInvite?.id ?? null,
                inviteLink: null,
                inviteMessage: null,
                whatsappUrl: null,
                status: workerInviteStatus,
                expiresAt: latestInvite?.expires_at ?? null,
              }}
            />
          </div>
        </details>

        <div data-tour="worker-detail-summary">
          <WorkerSummaryStats
            totalJobHours={totalJobHours}
            totalOutsideJobHours={totalStandaloneShiftHours}
            totalShiftHours={totalShiftHours}
            shiftReward={shiftReward}
            customerCoveredReward={customerCoveredReward}
            companyCoveredReward={companyCoveredReward}
            payrollBonusTotal={payrollBonusTotal}
            payrollMealTotal={payrollMealTotal}
            payrollDeductionTotal={payrollDeductionTotal}
            totalRewardAfterAdvance={totalRewardAfterAdvance}
          />
        </div>

        <section data-tour="worker-detail-advances" style={sectionCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
              <h2 style={{ ...cardTitleStyle, margin: 0 }}>Žádosti o zálohy ({advancePeriodLabel})</h2>
              <Link href="/advance-requests" style={secondaryButtonStyle}>
                Otevřít žádosti
              </Link>
            </div>

            {advanceRequestsForPeriod.length === 0 ? (
              <div style={boxStyle}>
                <p style={{ margin: 0, color: '#6b7280' }}>
                  Ve zvoleném období nejsou evidované žádné žádosti o zálohu.
                </p>
              </div>
            ) : (
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Požádáno</th>
                      <th style={thStyle}>Požadováno</th>
                      <th style={thStyle}>Částka</th>
                      <th style={thStyle}>Důvod</th>
                      <th style={thStyle}>Stav</th>
                      <th style={thStyle}>Vyřízeno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advanceRequestsForPeriod.map((request) => {
                      const status = getAdvanceRequestStatus(request)
                      const badgeStyle = getRequestStatusBadgeStyle(status)
                      const resolvedAt =
                        status === 'paid'
                          ? request.paid_at
                          : request.approved_at || request.reviewed_at

                      return (
                        <tr key={request.id}>
                          <td style={tdStyle}>{formatDate(request.requested_at)}</td>
                          <td style={tdStyle}>{formatCurrency(getAdvanceRequestRequestedAmount(request))}</td>
                          <td style={tdStyle}>{formatCurrency(getAdvanceRequestAmount(request))}</td>
                          <td style={tdStyle}>{request.reason?.trim() || request.note?.trim() || '—'}</td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                ...badgeStyle,
                                display: 'inline-block',
                                padding: '6px 10px',
                                borderRadius: '999px',
                                fontSize: '12px',
                                fontWeight: 800,
                                lineHeight: 1.2,
                              }}
                            >
                              {getRequestStatusLabel(status)}
                            </span>
                          </td>
                          <td style={tdStyle}>{formatDate(resolvedAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section data-tour="worker-detail-absences" style={sectionCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
            <h2 style={{ ...cardTitleStyle, margin: 0 }}>Žádosti o nepřítomnost ({workPeriodLabel})</h2>
            <Link href="/absences" style={secondaryButtonStyle}>
              Otevřít žádosti
            </Link>
          </div>

          {absenceRequests.length === 0 ? (
            <div style={boxStyle}>
              <p style={{ margin: 0, color: '#6b7280' }}>
                Ve zvoleném období nejsou evidované žádné žádosti o nepřítomnost.
              </p>
            </div>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Typ</th>
                    <th style={thStyle}>Od</th>
                    <th style={thStyle}>Do</th>
                    <th style={thStyle}>Poznámka</th>
                    <th style={thStyle}>Stav</th>
                    <th style={thStyle}>Podáno</th>
                  </tr>
                </thead>
                <tbody>
                  {absenceRequests.map((absence) => {
                    const status = getAbsenceRequestStatus(absence)
                    const badgeStyle = getRequestStatusBadgeStyle(status)

                    return (
                      <tr key={absence.id}>
                        <td style={tdStyle}>{getAbsenceTypeLabel(absence)}</td>
                        <td style={tdStyle}>{formatDate(absence.start_at)}</td>
                        <td style={tdStyle}>{formatDate(absence.end_at ?? absence.start_at)}</td>
                        <td style={tdStyle}>{absence.note?.trim() || '—'}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              ...badgeStyle,
                              display: 'inline-block',
                              padding: '6px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: 800,
                              lineHeight: 1.2,
                            }}
                          >
                            {getRequestStatusLabel(status)}
                          </span>
                        </td>
                        <td style={tdStyle}>{formatDate(absence.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section data-tour="worker-detail-approved-absences" style={sectionCardStyle}>
          <h2 style={{ ...cardTitleStyle, marginBottom: '16px' }}>Schválené nepřítomnosti ({workPeriodLabel})</h2>

          {approvedAbsences.length === 0 ? (
            <div style={boxStyle}>
              <p style={{ margin: 0, color: '#6b7280' }}>
                Ve zvoleném období nejsou evidované žádné schválené nepřítomnosti.
              </p>
            </div>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Typ</th>
                    <th style={thStyle}>Od</th>
                    <th style={thStyle}>Do</th>
                    <th style={thStyle}>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedAbsences.map((absence) => {
                    const badgeStyle = getAbsenceBadgeStyle(absence)

                    return (
                      <tr key={absence.id}>
                        <td style={tdStyle}>
                          <span
                            style={{
                              ...badgeStyle,
                              display: 'inline-block',
                              padding: '6px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: 700,
                              lineHeight: 1.2,
                            }}
                          >
                            {getAbsenceTypeLabel(absence)}
                          </span>
                        </td>
                        <td style={tdStyle}>{formatDate(absence.start_at)}</td>
                        <td style={tdStyle}>{formatDate(absence.end_at ?? absence.start_at)}</td>
                        <td style={tdStyle}>Schváleno</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div data-tour="worker-detail-assignments">
        <WorkerAssignmentsSection
          workPeriodLabel={workPeriodLabel}
          jobAssignments={jobAssignments}
          defaultRate={defaultHourlyRate}
        />
        </div>

        <div style={{ marginBottom: '24px', display: 'none' }}>
          <h2 style={sectionTitleStyle}>
            {dictionary.workers.workLogs} ({workPeriodLabel})
          </h2>

          {workLogs.length === 0 ? (
            <div style={boxStyle}>
              <p style={{ margin: 0, color: '#6b7280' }}>
                {dictionary.workers.detail.noWorkLogs}
              </p>
            </div>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{dictionary.customers.date}</th>
                    <th style={thStyle}>{dictionary.workers.detail.job}</th>
                    <th style={thStyle}>{dictionary.jobs.detail.hours}</th>
                  </tr>
                </thead>
                <tbody>
                  {workLogs.map((item, index) => (
                    <tr key={`${item.job_id ?? 'log'}-${item.work_date ?? index}`}>
                      <td style={tdStyle}>{formatDate(item.work_date)}</td>
                      <td style={tdStyle}>
                        {item.jobs ? (
                          <Link
                            href={`/jobs/${item.jobs.id}`}
                            style={{
                              color: '#111827',
                              textDecoration: 'none',
                              fontWeight: 700,
                            }}
                          >
                            {item.jobs.title ?? dictionary.workers.detail.unnamedJob}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={tdStyle}>{formatHours(Number(item.hours ?? 0))} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div data-tour="worker-detail-advance-form">
          <WorkerAdvancesSection
            advancePeriodLabel={advancePeriodLabel}
            selectedMonth={selectedMonth}
            workerId={workerId}
            workerAdvances={displayedWorkerAdvances}
            advancesAllowed={advanceSettings.advancesAllowed && !advanceSettings.unsupportedLimit}
            advanceLimitAmount={advanceSettings.advanceLimitAmount}
            totalAdvances={advancePaidInPeriod}
            currency={advanceSettings.currency}
            companyId={pageAccess.value.companyId}
            actorProfileId={pageAccess.value.profileId}
            timeZone={pageAccess.value.timeZone}
          />
        </div>

        <div data-tour="worker-detail-shifts">
        <WorkerShiftsSection
          workPeriodLabel={workPeriodLabel}
          workShifts={workShifts}
          shiftJobs={shiftJobs}
          shiftJobsMap={shiftJobsMap}
          workShiftsSupportJobAssignment={workShiftsSupportJobAssignment}
          workerId={workerId}
          companyId={shiftCompanyId}
          selectedMonth={selectedMonth}
          exportHref={`/api/workers/${workerId}/shifts/export?month=${selectedMonth}`}
          createShiftAction={createWorkerShift}
        />
        </div>

        <section style={sectionCardStyle}>
          <h2 style={{ ...cardTitleStyle, marginBottom: '16px' }}>Výplatní nastavení</h2>

          {isContractor ? (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div style={{ ...metaItemStyle, gridColumn: '1 / -1' }}>
                <div style={metaLabelStyle}>Režim</div>
                <div style={metaValueStyle}>Tento pracovník je vedený jako externí / subdodavatel.</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Typ vyúčtování</div>
                <div style={metaValueStyle}>{getContractorBillingTypeLabel(profile.contractor_billing_type)}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Výchozí sazba / cena</div>
                <div style={metaValueStyle}>
                  {profile.contractor_default_rate != null ? formatCurrency(Number(profile.contractor_default_rate)) : '—'}
                </div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Zálohy</div>
                <div style={metaValueStyle}>{advanceSettings.advancesAllowed ? 'Povoleny' : 'Nepovoleny'}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Limit záloh</div>
                <div style={metaValueStyle}>
                  {advanceSettings.advanceLimitAmount != null
                    ? formatCurrency(advanceSettings.advanceLimitAmount)
                    : 'Bez limitu'}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div style={{ ...metaItemStyle, gridColumn: '1 / -1' }}>
                <div style={metaLabelStyle}>Zdroj nastavení</div>
                <div style={metaValueStyle}>{'Firemní nastavení a individuální výjimky této firmy'}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Typ výplaty</div>
                <div style={metaValueStyle}>{({ monthly: 'Měsíčně', weekly: 'Týdně', biweekly: 'Jednou za 14 dní', after_shift: 'Po směně' } as Record<string, string>)[advanceSettings.payType ?? ''] ?? 'Nenastaveno'}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Den výplaty</div>
                <div style={metaValueStyle}>
                  {advanceSettings.payday ? `${advanceSettings.payday}. den následujícího měsíce` : 'Nenastaveno'}
                </div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Zálohy</div>
                <div style={metaValueStyle}>{advanceSettings.advancesAllowed ? 'Povoleny' : 'Nepovoleny'}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Limit záloh</div>
                <div style={metaValueStyle}>
                  {advanceSettings.advanceLimitAmount != null
                    ? formatCurrency(advanceSettings.advanceLimitAmount)
                    : 'Bez limitu'}
                </div>
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            ...sectionCardStyle,
            borderColor: 'rgba(248, 113, 113, 0.35)',
            background: 'rgba(255, 247, 247, 0.92)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: '680px' }}>
              <h2 style={{ ...cardTitleStyle, color: '#991b1b' }}>Smazat pracovníka</h2>
              <p style={{ margin: '8px 0 0', color: '#7f1d1d', lineHeight: 1.5, fontSize: '14px' }}>
                Pracovník se odebere z aktivního týmu a jeho čekající pozvánky se zruší. Historické směny,
                zakázky a výplaty zůstanou zachované pro reporting.
              </p>
            </div>
            <form action={deleteWorker} style={{ display: 'grid', gap: '10px', minWidth: '260px' }}>
              <input type="hidden" name="profileId" value={workerId} />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#7f1d1d',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                <input type="checkbox" name="confirmDelete" required />
                Opravdu smazat tohoto pracovníka
              </label>
              <button
                type="submit"
                style={{
                  ...secondaryButtonStyle,
                  width: '100%',
                  borderColor: '#fecaca',
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                }}
              >
                Smazat pracovníka
              </button>
            </form>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}
