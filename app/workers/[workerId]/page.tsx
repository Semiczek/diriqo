import Link from 'next/link'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import WorkerAdvancesSection from '@/app/workers/[workerId]/WorkerAdvancesSection'
import WorkerAssignmentsSection from '@/app/workers/[workerId]/WorkerAssignmentsSection'
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
  formatCurrency,
  formatDate,
  formatHours,
  getAdvanceRange,
  getEffectiveAssignmentHours,
  getEffectiveAssignmentRate,
  getEffectiveShiftHours,
  getTodayMonthString,
  getWorkMonthRange,
  isDateInRange,
  doesDateRangeOverlap,
  getWorkerName,
  isAdvanceRequestRepresentedByWorkerAdvance,
  isMissingWorkShiftAssignmentColumn,
  isValidMonthString,
  mapAdvanceRequestToWorkerAdvance,
  monthNavButtonStyle,
  normalizeJobAssignments,
  sectionTitleStyle,
  shiftMonth,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import { getRequestDictionary } from '@/lib/i18n/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  getContractorBillingTypeLabel,
  getEffectivePayrollSettings,
  getWorkerType,
  getWorkerTypeLabel,
} from '@/lib/payroll-settings'
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
  metaGridStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  pageShellStyle,
  primaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type AbsenceRow = {
  id: string
  profile_id: string | null
  absence_mode: string | null
  absence_type: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
}

type CompanyPayrollSettingsRow = {
  payroll_type: string | null
  payroll_day_of_month: number | null
  payroll_weekday: number | null
  payroll_anchor_date: string | null
  allow_advances: boolean | null
  advance_limit_amount: number | null
  advance_frequency: string | null
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

export default async function WorkerDetailPage({ params, searchParams }: WorkerDetailPageProps) {
  const dictionary = await getRequestDictionary()
  const { workerId } = await params
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
    advanceStartDate,
    advanceEndExclusiveDate,
    payDateLabel,
    advancePeriodLabel,
    monthLabel,
  } = getAdvanceRange(selectedMonth)

  const previousMonth = shiftMonth(selectedMonth, -1)
  const nextMonth = shiftMonth(selectedMonth, 1)

  const supabase = await createSupabaseServerClient()

  const profileResponse = await supabase
    .from('profiles')
    .select(`
      id,
      full_name,
      email,
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
    jobAssignmentsResponse,
    workerJobAssignmentSummaryResponse,
    workerAdvancesResponse,
    advanceRequestsResponse,
    payrollItemsResponse,
    companyMembersResponse,
    absencesResponse,
  ] =
    await Promise.all([
      supabase
        .from('job_assignments')
        .select(`
          id,
          job_id,
          profile_id,
          labor_hours,
          hourly_rate,
          work_started_at,
          work_completed_at,
          jobs (
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
        `)
        .eq('profile_id', workerId)
        .is('archived_at', null),
      supabase
        .from('worker_job_assignment_summary')
        .select('assignment_id, job_id, profile_id, labor_hours_total, effective_hourly_rate, labor_cost_total')
        .eq('profile_id', workerId),
      supabase
        .from('worker_advances')
        .select('id, profile_id, amount, issued_at, note')
        .eq('profile_id', workerId)
        .gte('issued_at', advanceStartDate)
        .lt('issued_at', advanceEndExclusiveDate)
        .order('issued_at', { ascending: false }),
      supabase
        .from('advance_requests')
        .select('id, profile_id, amount, requested_amount, reason, note, status, requested_at, approved_at, reviewed_at, paid_at, payroll_month')
        .eq('profile_id', workerId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false }),
      supabase
        .from('payroll_items')
        .select('id, profile_id, payroll_month, item_type, amount, note, created_at')
        .eq('profile_id', workerId)
        .eq('payroll_month', selectedMonth)
        .order('created_at', { ascending: false }),
      supabase
        .from('company_members')
        .select('company_id')
        .eq('profile_id', workerId)
        .eq('is_active', true)
        .limit(1),
      supabase
        .from('absence_requests')
        .select('id, profile_id, absence_mode, absence_type, start_at, end_at, status')
        .eq('profile_id', workerId)
        .eq('status', 'approved')
        .order('start_at', { ascending: false }),
    ])

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

  if (companyMembersResponse.error) {
    return renderError(`${dictionary.workers.detail.loadMembersFailed}: ${companyMembersResponse.error.message}`)
  }

  if (absencesResponse.error) {
    return renderError(`Nepodařilo se načíst nepřítomnosti: ${absencesResponse.error.message}`)
  }

  let workShiftsSupportJobAssignment = true
  let workShiftsData: Array<Partial<WorkShiftRow>> | null = null
  let workShiftsError: { message: string } | null = null

  const workShiftsWithJobResponse = await supabase
    .from('work_shifts')
    .select('id, profile_id, company_id, job_id, job_hours_override, shift_date, started_at, ended_at, hours_override, note')
    .eq('profile_id', workerId)
    .gte('shift_date', workStartDate)
    .lt('shift_date', workEndExclusiveDate)
    .order('started_at', { ascending: false })

  if (
    workShiftsWithJobResponse.error &&
    isMissingWorkShiftAssignmentColumn(workShiftsWithJobResponse.error.message)
  ) {
    workShiftsSupportJobAssignment = false

    const fallbackWorkShiftsResponse = await supabase
      .from('work_shifts')
      .select('id, profile_id, company_id, shift_date, started_at, ended_at, hours_override, note')
      .eq('profile_id', workerId)
      .gte('shift_date', workStartDate)
      .lt('shift_date', workEndExclusiveDate)
      .order('started_at', { ascending: false })

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
      ? await supabase.from('jobs_with_state').select('id, time_state, work_state').in('id', assignmentJobIds)
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
  const paidAdvanceRequestsForPeriod = (((advanceRequestsResponse.data ?? []) as unknown[]) as AdvanceRequestPayrollRow[])
    .filter((item) => !isAdvanceRequestRepresentedByWorkerAdvance(item, workerAdvances))
    .map(mapAdvanceRequestToWorkerAdvance)
    .filter((item) => isDateInRange(item.issued_at, advanceStartDate, advanceEndExclusiveDate))
  const displayedWorkerAdvances = [...workerAdvances, ...paidAdvanceRequestsForPeriod].sort((a, b) => {
    const aTime = a.issued_at ? new Date(a.issued_at).getTime() : 0
    const bTime = b.issued_at ? new Date(b.issued_at).getTime() : 0
    return bTime - aTime
  })
  const approvedAbsences = (((absencesResponse.data ?? []) as unknown[]) as AbsenceRow[]).filter((absence) =>
    doesDateRangeOverlap(
      absence.start_at,
      absence.end_at ?? absence.start_at,
      workStartIso,
      workEndExclusiveIso,
    ),
  )
  const companyMember = (((companyMembersResponse.data ?? []) as unknown[]) as CompanyMemberRow[])[0] ?? null
  const companyPayrollSettingsResponse = companyMember?.company_id
    ? await supabase
        .from('company_payroll_settings')
        .select('payroll_type, payroll_day_of_month, payroll_weekday, payroll_anchor_date, allow_advances, advance_limit_amount, advance_frequency')
        .eq('company_id', companyMember.company_id)
        .maybeSingle()
    : { data: null, error: null }

  if (companyPayrollSettingsResponse.error) {
    return renderError(`Nepodařilo se načíst výplatní nastavení firmy: ${companyPayrollSettingsResponse.error.message}`)
  }

  const companyPayrollSettings = companyPayrollSettingsResponse.data as CompanyPayrollSettingsRow | null
  const workerType = getWorkerType(profile)
  const isContractor = workerType === 'contractor'
  const effectivePayrollSettings = getEffectivePayrollSettings(profile, companyPayrollSettings)

  const shiftCompanyId =
    workShifts.find((item) => item.company_id)?.company_id ??
    mergedJobAssignments.find((item) => item.jobs?.company_id)?.jobs?.company_id ??
    companyMember?.company_id ??
    null

  const shiftLinkedJobIds = new Set(
    workShifts
      .map((item) => item.job_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )

  const shiftJobsResponse =
    shiftCompanyId && workShiftsSupportJobAssignment
      ? await supabase
          .from('jobs')
          .select('id, title, start_at, end_at')
          .eq('company_id', shiftCompanyId)
          .order('start_at', { ascending: false })
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
  const defaultHourlyRate = Number(profile.default_hourly_rate ?? 0)
  const totalJobHours = jobAssignments.reduce((sum, item) => sum + getEffectiveAssignmentHours(item), 0)
  const totalStandaloneShiftHours = Math.max(0, totalShiftHours - totalJobHours)
  const shiftReward = totalShiftHours * defaultHourlyRate
  const customerCoveredReward = jobAssignments.reduce(
    (sum, item) => sum + getEffectiveAssignmentHours(item) * getEffectiveAssignmentRate(item, defaultHourlyRate),
    0,
  )
  const companyCoveredReward = totalStandaloneShiftHours * defaultHourlyRate
  const payrollReward = customerCoveredReward + companyCoveredReward
  const advancePaidInPeriod = isContractor
    ? 0
    : displayedWorkerAdvances.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
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
  const totalRewardAfterAdvance =
    isContractor
      ? customerCoveredReward
      : payrollReward + payrollBonusTotal + payrollMealTotal - payrollDeductionTotal - advancePaidInPeriod

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
      company_id: companyId || null,
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

  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <SecondaryAction href={`/workers?month=${selectedMonth}`}>
          {dictionary.workers.detail.backToWorkers}
        </SecondaryAction>

        <section style={heroCardStyle}>
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
                  {dictionary.workers.workingMonth}: {workPeriodLabel}. {dictionary.workers.advancesForPayroll}: {advancePeriodLabel}. {dictionary.workers.payrollDue}: {payDateLabel}.
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
              {isContractor
                ? `Externí práce ${formatHours(totalJobHours)} h, zálohy se nepoužívají.`
                : `Zakázky ${formatHours(totalJobHours)} h, směny mimo zakázky ${formatHours(totalStandaloneShiftHours)} h, zálohy ${formatCurrency(advancePaidInPeriod)}.`}
            </div>
            <Link
              href={`/workers/${workerId}/finance/edit?month=${selectedMonth}`}
              style={{ ...primaryButtonStyle, marginTop: '16px', width: '100%', boxSizing: 'border-box' }}
            >
              {dictionary.workers.detail.editWorker}
            </Link>
          </div>
        </section>

        <section style={sectionCardStyle}>
          <h2 style={{ ...cardTitleStyle, marginBottom: '16px' }}>{dictionary.workers.detail.basicInfo}</h2>

          <div
            style={{
              ...metaGridStyle,
              marginTop: 0,
            }}
          >
            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.name}</div>
              <div style={metaValueStyle}>{getWorkerName(profile)}</div>
            </div>

            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>Typ pracovníka</div>
              <div style={metaValueStyle}>{getWorkerTypeLabel(profile.worker_type)}</div>
            </div>

            <div style={{ ...metaItemStyle, gridColumn: 'span 2', minWidth: 0 }}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.email}</div>
              <div style={{ ...metaValueStyle, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{profile.email ?? '—'}</div>
            </div>

            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.defaultRate}</div>
              <div style={metaValueStyle}>
                {profile.default_hourly_rate ? formatCurrency(Number(profile.default_hourly_rate)) : '—'}
              </div>
            </div>

            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.advancesForPayroll}</div>
              <div style={metaValueStyle}>{formatCurrency(advancePaidInPeriod)}</div>
            </div>

            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.workMonth}</div>
              <div style={metaValueStyle}>{workPeriodLabel}</div>
            </div>

            <div style={metaItemStyle}>
              <div style={metaLabelStyle}>{dictionary.workers.detail.advancesPeriod}</div>
              <div style={metaValueStyle}>{advancePeriodLabel}</div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <details
                style={{
                  ...metaItemStyle,
                  color: '#64748b',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 850, color: '#475569' }}>
                  Technické informace
                </summary>
                <div style={{ marginTop: '10px', wordBreak: 'break-all', fontSize: '13px' }}>
                  {dictionary.workers.detail.profileId}: {profile.id}
                </div>
              </details>
            </div>
          </div>
        </section>

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
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div style={{ ...metaItemStyle, gridColumn: '1 / -1' }}>
                <div style={metaLabelStyle}>Zdroj nastavení</div>
                <div style={metaValueStyle}>{effectivePayrollSettings.label}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Typ výplaty</div>
                <div style={metaValueStyle}>{effectivePayrollSettings.payrollTypeLabel}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Den výplaty</div>
                <div style={metaValueStyle}>
                  {effectivePayrollSettings.payrollDayOfMonth
                    ? `${effectivePayrollSettings.payrollDayOfMonth}. den v měsíci`
                    : effectivePayrollSettings.payrollWeekday
                      ? `Den v týdnu: ${effectivePayrollSettings.payrollWeekday}`
                      : '—'}
                </div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Zálohy</div>
                <div style={metaValueStyle}>{effectivePayrollSettings.advancesAllowed ? 'Povoleny' : 'Nepovoleny'}</div>
              </div>
              <div style={metaItemStyle}>
                <div style={metaLabelStyle}>Limit záloh</div>
                <div style={metaValueStyle}>
                  {effectivePayrollSettings.advanceLimitAmount != null
                    ? formatCurrency(effectivePayrollSettings.advanceLimitAmount)
                    : 'Bez limitu'}
                </div>
              </div>
            </div>
          )}
        </section>

        {!isContractor ? (
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
        ) : null}

        <section style={sectionCardStyle}>
          <h2 style={{ ...cardTitleStyle, marginBottom: '16px' }}>Nepřítomnosti ({workPeriodLabel})</h2>

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

        <WorkerAssignmentsSection
          workPeriodLabel={workPeriodLabel}
          jobAssignments={jobAssignments}
          defaultRate={Number(profile.default_hourly_rate ?? 0)}
        />

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

        {!isContractor ? (
          <WorkerAdvancesSection advancePeriodLabel={advancePeriodLabel} workerAdvances={displayedWorkerAdvances} />
        ) : null}

        <WorkerShiftsSection
          workPeriodLabel={workPeriodLabel}
          workShifts={workShifts}
          shiftJobs={shiftJobs}
          shiftJobsMap={shiftJobsMap}
          workShiftsSupportJobAssignment={workShiftsSupportJobAssignment}
          workerId={workerId}
          companyId={shiftCompanyId}
          selectedMonth={selectedMonth}
          createShiftAction={createWorkerShift}
        />
      </main>
    </DashboardShell>
  )
}
