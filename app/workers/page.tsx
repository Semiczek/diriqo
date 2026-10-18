import { readAdvanceSettings } from '@/lib/dal/advance-settings'
import { readPayrollAdvanceLedger } from '@/lib/dal/worker-advances'
import { payrollAdvanceTotal } from '@/lib/payroll/advances'
import type { CSSProperties } from 'react'

import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import styles from './workers.module.css'
import { requireWorkerAccess } from '@/lib/server-guards'
import { getIntlLocale } from '@/lib/i18n/config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
import {
  doesDateRangeOverlap,
  getAdvanceRange,
  getEffectiveAssignmentHours,
  getEffectiveAssignmentRate,
  getEffectiveAssignmentReward,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import { getWorkerType, getWorkerTypeLabel } from '@/lib/payroll-settings'
import { calculateWorkerPayroll, type WorkerPayrollBaseSource } from '@/lib/payroll/worker-payroll'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type WorkersPageProps = {
  searchParams?: Promise<{
    month?: string
  }>
}


type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone?: string | null
  worker_status?: string | null
  activated_at?: string | null
  disabled_at?: string | null
  last_seen_at?: string | null
  device_registered_at?: string | null
  default_hourly_rate: number | null
  advance_paid: number | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | null
}

type CompanyMemberRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  is_active: boolean | null
}

type JobRelation = {
  id: string
  title: string | null
  address: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  price: number | null
  is_paid: boolean | null
}

type JobAssignmentRow = {
  id?: string
  job_id: string | null
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  work_started_at?: string | null
  work_completed_at?: string | null
  effective_hours?: number | null
  effective_rate?: number | null
  effective_reward?: number | null
  jobs: JobRelation | null
}

type WorkLogRow = {
  profile_id: string | null
  hours: number | null
  work_date: string | null
}

type WorkShiftRow = {
  id: string
  profile_id: string | null
  job_id?: string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | null
  job_hours_override?: number | null
}

type PayrollItemRow = {
  profile_id: string | null
  payroll_month: string | null
  item_type: string | null
  amount: number | string | null
}

type AbsenceRow = {
  id: string
  profile_id: string | null
  absence_mode: string | null
  absence_type: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
}

type WorkerAbsenceState = 'healthy' | 'vacation' | 'sick'

type WorkerCardData = {
  id: string
  fullName: string
  email: string
  defaultHourlyRate: number
  advancePaidInPeriod: number
  jobAssignmentHours: number
  jobAssignmentReward: number
  workLogHours: number
  shiftHoursMonth: number
  shiftReward: number
  workerType: string
  payrollBaseSource: WorkerPayrollBaseSource
  payrollBonusTotal: number
  payrollMealTotal: number
  payrollDeductionTotal: number
  totalRewardAfterAdvance: number
  payrollPaidAt: string | null
  payrollPaidAmount: number
  absenceState: WorkerAbsenceState
  inviteStatus: 'invited' | 'active' | 'disabled'
  activatedAt: string | null
  lastSeenAt: string | null
  deviceRegisteredAt: string | null
}

type RawJobRelation = {
  id?: string | null
  title?: string | null
  address?: string | null
  status?: string | null
  start_at?: string | null
  end_at?: string | null
  price?: number | string | null
  is_paid?: boolean | null
} | null

type RawJobAssignmentRow = {
  id?: string | null
  job_id?: string | null
  profile_id?: string | null
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | string | null
  work_started_at?: string | null
  work_completed_at?: string | null
  jobs?: RawJobRelation | RawJobRelation[]
}

type WorkerJobAssignmentSummaryRow = {
  assignment_id: string | null
  job_id: string | null
  profile_id: string | null
  labor_hours_total: number | string | null
  effective_hourly_rate: number | string | null
  labor_cost_total: number | string | null
}

type PayrollPaymentRow = {
  profile_id: string | null
  payroll_month: string | null
  amount: number | string | null
  paid_at: string | null
}

function getTodayMonthString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function isValidMonthString(value: string | undefined) {
  if (!value) return false
  return /^\d{4}-\d{2}$/.test(value)
}

function shiftMonth(monthString: string, diff: number) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const date = new Date(year, monthIndex + diff, 1, 0, 0, 0, 0)

  const newYear = date.getFullYear()
  const newMonth = String(date.getMonth() + 1).padStart(2, '0')

  return `${newYear}-${newMonth}`
}

function getShiftHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return 0

  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()

  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  if (end <= start) return 0

  return (end - start) / (1000 * 60 * 60)
}

function getEffectiveShiftHours(shift: WorkShiftRow) {
  if (shift.hours_override != null) {
    return Number(shift.hours_override)
  }

  return getShiftHours(shift.started_at, shift.ended_at)
}

function getWorkerName(profile: ProfileRow, fallback: string) {
  if (profile.full_name && profile.full_name.trim()) {
    return profile.full_name.trim()
  }

  if (profile.email && profile.email.trim()) {
    return profile.email.trim()
  }

  return fallback
}

function formatLocalDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWorkMonthRange(monthString: string, locale: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const workStart = new Date(year, monthIndex, 1, 0, 0, 0, 0)
  const workEndExclusive = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0)
  const workEndVisible = new Date(year, monthIndex + 1, 0, 0, 0, 0, 0)

  const formatDateLabel = (value: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(value)

  return {
    workStartDate: formatLocalDateKey(workStart),
    workEndExclusiveDate: formatLocalDateKey(workEndExclusive),
    workStartIso: workStart.toISOString(),
    workEndExclusiveIso: workEndExclusive.toISOString(),
    workPeriodLabel: `${formatDateLabel(workStart)} - ${formatDateLabel(workEndVisible)}`,
  }
}

function normalizeJobAssignments(data: RawJobAssignmentRow[]): JobAssignmentRow[] {
  return data.map((item) => {
    const rawJob = Array.isArray(item?.jobs) ? item.jobs[0] ?? null : item?.jobs ?? null

    return {
      id: item?.id ?? undefined,
      job_id: item?.job_id ?? rawJob?.id ?? null,
      profile_id: item?.profile_id ?? null,
      labor_hours: item?.labor_hours != null ? Number(item.labor_hours) : null,
      hourly_rate: item?.hourly_rate != null ? Number(item.hourly_rate) : null,
      worker_type_snapshot: item?.worker_type_snapshot ?? null,
      assignment_billing_type: item?.assignment_billing_type ?? null,
      external_amount: item?.external_amount != null ? Number(item.external_amount) : null,
      work_started_at: item?.work_started_at ?? null,
      work_completed_at: item?.work_completed_at ?? null,
      jobs: rawJob
        ? {
            id: rawJob.id ?? '',
            title: rawJob.title ?? null,
            address: rawJob.address ?? null,
            status: rawJob.status ?? null,
            start_at: rawJob.start_at ?? null,
            end_at: rawJob.end_at ?? null,
            price: rawJob.price != null ? Number(rawJob.price) : null,
            is_paid: rawJob.is_paid ?? null,
          }
        : null,
    }
  })
}

function isAbsenceActiveNow(absence: AbsenceRow, now: Date) {
  if (absence.status !== 'approved') return false
  if (!absence.start_at || !absence.end_at) return false

  const start = new Date(absence.start_at)
  const end = new Date(absence.end_at)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false

  return start.getTime() <= now.getTime() && end.getTime() >= now.getTime()
}

function getWorkerAbsenceState(absences: AbsenceRow[], now: Date): WorkerAbsenceState {
  const activeAbsences = absences.filter((item) => isAbsenceActiveNow(item, now))

  if (activeAbsences.some((item) => item.absence_type === 'sick' || item.absence_mode === 'sick')) {
    return 'sick'
  }

  if (activeAbsences.length > 0) {
    return 'vacation'
  }

  return 'healthy'
}

function getAbsenceVisual(state: WorkerAbsenceState) {
  if (state === 'sick') {
    return {
      cardBorder: '#ef4444',
      cardBackground: '#fff7f7',
      badgeBackground: '#fee2e2',
      badgeColor: '#b91c1c',
      accentBackground: '#fef2f2',
    }
  }

  if (state === 'vacation') {
    return {
      cardBorder: '#f97316',
      cardBackground: '#fffaf5',
      badgeBackground: '#ffedd5',
      badgeColor: '#c2410c',
      accentBackground: '#fff7ed',
    }
  }

  return {
    cardBorder: '#22c55e',
    cardBackground: '#f7fff9',
    badgeBackground: '#dcfce7',
    badgeColor: '#166534',
    accentBackground: '#f0fdf4',
  }
}

function isMissingPayrollPaymentsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message ?? '').toLowerCase()
  return error?.code === '42P01' || message.includes('payroll_payments')
}

export default async function WorkersPage({ searchParams }: WorkersPageProps) {
  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()
  const intlLocale = getIntlLocale(locale)

  const formatHours = (value: number) =>
    new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(intlLocale, { style: 'currency', currency: advanceSettings.currency, maximumFractionDigits: 2 }).format(value)

  const getAbsenceLabel = (state: WorkerAbsenceState) => {
    if (state === 'sick') return dictionary.workers.sick
    if (state === 'vacation') return dictionary.workers.vacation
    return dictionary.workers.healthy
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const monthParam = resolvedSearchParams?.month

  const selectedMonth = typeof monthParam === 'string' && isValidMonthString(monthParam) ? monthParam : getTodayMonthString()

  const { workStartDate, workEndExclusiveDate, workStartIso, workEndExclusiveIso, workPeriodLabel } =
    getWorkMonthRange(selectedMonth, intlLocale)

  const previousMonth = shiftMonth(selectedMonth, -1)
  const nextMonth = shiftMonth(selectedMonth, 1)
  const workersExportHref = `/api/workers/export?month=${selectedMonth}`

  const access = await requireWorkerAccess()
  const activeCompany = access.ok ? access.value : null
  const supabase = await createSupabaseServerClient()

  const renderError = (message: string) => (
    <DashboardShell activeItem="workers">
      <main style={{ maxWidth: '1100px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827' }}>
        <div style={{ border: '1px solid #fdba74', background: '#fff7ed', color: '#9a3412', borderRadius: '16px', padding: '24px' }}>
          {message}
        </div>
      </main>
    </DashboardShell>
  )

  if (!activeCompany) {
    return renderError(dictionary.auth.noHubAccess)
  }

  if (!['company_admin', 'super_admin'].includes(activeCompany.role ?? '')) return renderError('K financím pracovníků nemáte oprávnění.')
  let advanceSettings: Awaited<ReturnType<typeof readAdvanceSettings>>
  try { advanceSettings = await readAdvanceSettings(supabase, activeCompany.companyId) }
  catch { return renderError('Výplatní nastavení aktivní firmy se nepodařilo načíst.') }
  const { payDateLabel, advancePeriodLabel, monthLabel } = getAdvanceRange(selectedMonth, advanceSettings.payType === 'monthly' ? advanceSettings.payday : null, intlLocale)

  const membersResponse = await supabase
    .from('company_members')
    .select('id, company_id, profile_id, is_active')
    .eq('company_id', activeCompany.companyId)
    .eq('is_active', true)
  if (membersResponse.error) {
    return renderError(`${dictionary.workers.companyMembersLoadError}: ${membersResponse.error.message}`)
  }

  const memberRows = (membersResponse.data ?? []) as CompanyMemberRow[]
  const profileIds = Array.from(new Set(memberRows.map((row) => row.profile_id).filter((value): value is string => Boolean(value))))

  if (profileIds.length === 0) {
    return (
      <DashboardShell activeItem="workers">
        <main style={{ maxWidth: '1100px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827' }}>
          <div style={{ border: '1px solid #e5e7eb', background: '#ffffff', color: '#6b7280', borderRadius: '16px', padding: '24px' }}>
            {dictionary.workers.noWorkers}
          </div>
        </main>
      </DashboardShell>
    )
  }

  const [
    profilesResponse,
    jobAssignmentsResponse,
    jobAssignmentSummariesResponse,
    workLogsResponse,
    workShiftsResponse,
    workerAdvancesResponse,
    payrollItemsResponse,
    payrollPaymentsResponse,
    absencesResponse,
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone, worker_status, activated_at, disabled_at, last_seen_at, device_registered_at, default_hourly_rate, advance_paid, worker_type, contractor_billing_type, contractor_default_rate').in('id', profileIds).order('full_name', { ascending: true }),
    supabase.from('job_assignments').select(`
      id,
      profile_id,
      job_id,
      labor_hours,
      hourly_rate,
      worker_type_snapshot,
      assignment_billing_type,
      external_amount,
      work_started_at,
      work_completed_at,
      jobs!inner (
        id,
        title,
        address,
        status,
        start_at,
        end_at,
        price,
        is_paid
      )
    `).in('profile_id', profileIds).is('archived_at', null),
    supabase
      .from('worker_job_assignment_summary')
      .select('assignment_id, job_id, profile_id, labor_hours_total, effective_hourly_rate, labor_cost_total')
      .in('profile_id', profileIds),
    supabase.from('work_logs').select('profile_id, hours, work_date').in('profile_id', profileIds).gte('work_date', workStartDate).lt('work_date', workEndExclusiveDate),
    supabase.from('work_shifts').select('id, profile_id, job_id, shift_date, started_at, ended_at, hours_override, job_hours_override').in('profile_id', profileIds).gte('shift_date', workStartDate).lt('shift_date', workEndExclusiveDate).order('started_at', { ascending: false }),
    readPayrollAdvanceLedger(supabase, activeCompany.companyId, { payrollMonth: `${selectedMonth}-01`, currency: advanceSettings.currency }),
    supabase
      .from('payroll_items')
      .select('profile_id, payroll_month, item_type, amount')
      .in('profile_id', profileIds)
      .eq('payroll_month', selectedMonth),
    supabase
      .from('payroll_payments')
      .select('profile_id, payroll_month, amount, paid_at')
      .eq('company_id', activeCompany.companyId)
      .in('profile_id', profileIds)
      .eq('payroll_month', selectedMonth),
    supabase.from('absence_requests').select('id, profile_id, absence_mode, absence_type, start_at, end_at, status').in('profile_id', profileIds).eq('status', 'approved'),
  ])

  if (profilesResponse.error) return renderError(`${dictionary.workers.profilesLoadError}: ${profilesResponse.error.message}`)
  if (jobAssignmentsResponse.error) return renderError(`${dictionary.workers.assignmentsLoadError}: ${jobAssignmentsResponse.error.message}`)
  if (jobAssignmentSummariesResponse.error) return renderError(`${dictionary.workers.detail.loadSummaryFailed}: ${jobAssignmentSummariesResponse.error.message}`)
  if (workLogsResponse.error) return renderError(`${dictionary.workers.workLogsLoadError}: ${workLogsResponse.error.message}`)
  if (workShiftsResponse.error) return renderError(`${dictionary.workers.shiftsLoadError}: ${workShiftsResponse.error.message}`)
  if (workerAdvancesResponse.error) return renderError(`${dictionary.workers.advancesLoadError}: ${workerAdvancesResponse.error.message}`)
  if (payrollItemsResponse.error) return renderError(`${dictionary.workers.detail.loadPayrollItemsFailed}: ${payrollItemsResponse.error.message}`)
  if (payrollPaymentsResponse.error && !isMissingPayrollPaymentsTable(payrollPaymentsResponse.error)) {
    return renderError(`Nepodařilo se načíst stav výplat: ${payrollPaymentsResponse.error.message}`)
  }
  if (absencesResponse.error) return renderError(`${dictionary.workers.absencesLoadError}: ${absencesResponse.error.message}`)

  const profiles = (profilesResponse.data ?? []) as ProfileRow[]
  const jobAssignments = normalizeJobAssignments((jobAssignmentsResponse.data ?? []) as RawJobAssignmentRow[])
  const jobAssignmentSummaries = ((jobAssignmentSummariesResponse.data ?? []) as WorkerJobAssignmentSummaryRow[]).map((item) => ({
    assignment_id: item.assignment_id,
    job_id: item.job_id,
    profile_id: item.profile_id,
    labor_hours_total: item.labor_hours_total != null ? Number(item.labor_hours_total) : null,
    effective_hourly_rate: item.effective_hourly_rate != null ? Number(item.effective_hourly_rate) : null,
    labor_cost_total: item.labor_cost_total != null ? Number(item.labor_cost_total) : null,
  }))
  const jobAssignmentSummaryMap = new Map(
    jobAssignmentSummaries
      .filter((item) => Boolean(item.assignment_id))
      .map((item) => [item.assignment_id as string, item])
  )
  const mergedJobAssignments = jobAssignments.map((assignment) => {
    const summary = assignment.id ? jobAssignmentSummaryMap.get(assignment.id) : null

    return {
      ...assignment,
      effective_hours: summary?.labor_hours_total ?? null,
      effective_rate: summary?.effective_hourly_rate ?? null,
      effective_reward: summary?.labor_cost_total ?? null,
    }
  })
  const workLogs = (workLogsResponse.data ?? []) as WorkLogRow[]
  const workShifts = (workShiftsResponse.data ?? []) as WorkShiftRow[]
  const workerAdvances = workerAdvancesResponse.data
  const payrollItems = ((payrollItemsResponse.data ?? []) as unknown[]) as PayrollItemRow[]
  const payrollPayments = payrollPaymentsResponse.error
    ? []
    : (((payrollPaymentsResponse.data ?? []) as unknown[]) as PayrollPaymentRow[])
  const absences = (absencesResponse.data ?? []) as AbsenceRow[]

  const now = new Date()

  const workers: WorkerCardData[] = profiles.map((profile) => {
    const workerJobAssignments = mergedJobAssignments.filter((item) => {
      if (item.profile_id !== profile.id) return false

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
      const hasShiftInMonth = workShifts.some((shift) => shift.profile_id === profile.id && shift.job_id != null && shift.job_id === item.job_id)

      return overlapsByJobRange || overlapsByWorkRange || hasShiftInMonth
    })
    const workerWorkLogs = workLogs.filter((item) => item.profile_id === profile.id)
    const workerShifts = workShifts.filter((item) => item.profile_id === profile.id)
    const workerAdvanceRows = workerAdvances.filter((item) => item.profile_id === profile.id)
    const workerPayrollItems = payrollItems.filter((item) => item.profile_id === profile.id)
    const workerPayrollPayment = payrollPayments.find((item) => item.profile_id === profile.id)
    const workerAbsences = absences.filter((item) => item.profile_id === profile.id)
    const workerType = getWorkerType(profile)
    const isContractor = workerType === 'contractor'

    const defaultHourlyRate = Number(
      isContractor
        ? profile.contractor_default_rate ?? profile.default_hourly_rate ?? 0
        : profile.default_hourly_rate ?? 0,
    )
    const assignmentRateByJobId = new Map<string, number>()
    for (const assignment of workerJobAssignments) {
      if (!assignment.job_id) continue
      assignmentRateByJobId.set(assignment.job_id, getEffectiveAssignmentRate(assignment, defaultHourlyRate))
    }
    const shiftCalculations = workerShifts.map((shift) => {
      const hours = getEffectiveShiftHours(shift)
      const rate = shift.job_id ? assignmentRateByJobId.get(shift.job_id) ?? defaultHourlyRate : defaultHourlyRate
      return {
        hours,
        reward: hours * rate,
      }
    })
    const jobAssignmentHours = workerJobAssignments.reduce((sum, item) => sum + getEffectiveAssignmentHours(item), 0)
    const jobAssignmentReward = workerJobAssignments.reduce(
      (sum, item) => sum + getEffectiveAssignmentReward(item, defaultHourlyRate, profile),
      0
    )
    const workLogHours = workerWorkLogs.reduce((sum, item) => sum + Number(item.hours ?? 0), 0)
    const shiftHoursMonth = shiftCalculations.reduce((sum, item) => sum + item.hours, 0)
    const shiftReward = shiftCalculations.reduce((sum, item) => sum + item.reward, 0)
    const advancePaidInPeriod = payrollAdvanceTotal(workerAdvanceRows, workerAdvancesResponse.settlements)
    const payrollBonusTotal = workerPayrollItems
      .filter((item) => item.item_type === 'bonus')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const payrollMealTotal = workerPayrollItems
      .filter((item) => item.item_type === 'meal')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const payrollDeductionTotal = workerPayrollItems
      .filter((item) => item.item_type === 'deduction')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const payroll = calculateWorkerPayroll({
      worker: profile,
      jobReward: jobAssignmentReward,
      shiftReward,
      bonusTotal: payrollBonusTotal,
      mealTotal: payrollMealTotal,
      deductionTotal: payrollDeductionTotal,
      advanceTotal: advancePaidInPeriod,
    })
    const absenceState = getWorkerAbsenceState(workerAbsences, now)

    return {
      id: profile.id,
      workerType,
      fullName: getWorkerName(profile, dictionary.workers.unnamedWorker),
      email: profile.email ?? '-',
      defaultHourlyRate,
      advancePaidInPeriod,
      payrollBaseSource: payroll.baseSource,
      jobAssignmentHours,
      jobAssignmentReward,
      workLogHours,
      shiftHoursMonth,
      shiftReward,
      payrollBonusTotal,
      payrollMealTotal,
      payrollDeductionTotal,
      totalRewardAfterAdvance: payroll.netPayout,
      payrollPaidAt: workerPayrollPayment?.paid_at ?? null,
      payrollPaidAmount: Number(workerPayrollPayment?.amount ?? 0),
      absenceState,
      inviteStatus:
        profile.worker_status === 'disabled' || profile.disabled_at
          ? 'disabled'
          : profile.activated_at || profile.worker_status === 'active'
            ? 'active'
            : 'invited',
      activatedAt: profile.activated_at ?? null,
      lastSeenAt: profile.last_seen_at ?? null,
      deviceRegisteredAt: profile.device_registered_at ?? null,
    }
  })

  const totalPeriodShiftHours = workers.reduce((sum, worker) => sum + worker.shiftHoursMonth, 0)
  const totalPeriodAssignments = workers.reduce((sum, worker) => sum + worker.jobAssignmentHours, 0)
  const totalPeriodAdvances = workers.reduce((sum, worker) => sum + worker.advancePaidInPeriod, 0)
  const totalPeriodPayroll = workers.reduce((sum, worker) => sum + worker.totalRewardAfterAdvance, 0)
  const totalPeriodPayrollPaid = workers
    .filter((worker) => worker.payrollPaidAt)
    .reduce((sum, worker) => sum + worker.payrollPaidAmount, 0)
  const totalPeriodPayrollUnpaid = Math.max(0, totalPeriodPayroll - totalPeriodPayrollPaid)

  const cardStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '14px', padding: '18px', background: '#ffffff', color: '#202534', textDecoration: 'none', display: 'block', boxShadow: 'none' }
  const statBoxStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '16px', padding: '14px 16px', background: '#ffffff', boxShadow: 'none' }
  const miniStatStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '12px', padding: '10px 11px', background: '#f8fafc' }
  const summaryWideBoxStyle: CSSProperties = { border: '1px solid rgba(203, 213, 225, 0.9)', borderRadius: '14px', padding: '11px 12px', background: '#f8fafc', marginBottom: '10px' }
  const monthNavButtonStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: '44px', padding: '8px 12px', borderRadius: '9px', background: '#ffffff', color: '#202534', textDecoration: 'none', fontSize: '14px', fontWeight: 600, border: '1px solid #e5e7eb', whiteSpace: 'nowrap', boxShadow: 'none' }

  return (
    <DashboardShell activeItem="workers">
      <main className={styles.page}>
        <div className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>
              Tým
            </div>
            <h1 style={{ margin: 0, fontSize: '32px', lineHeight: '1.08', fontWeight: 600, color: '#202534' }}>{dictionary.workers.title}</h1>
            <p style={{ margin: '8px 0 0 0', color: '#475569', fontSize: '14px', lineHeight: 1.45 }}>
              {dictionary.workers.workingMonth}: {workPeriodLabel}. {dictionary.workers.advancesForPayroll}: {advancePeriodLabel}. Firemní plán výplaty podle současného nastavení: {advanceSettings.payType === 'monthly' ? payDateLabel : 'Podle výplatního režimu'} (individuální výjimky v detailu pracovníka).
            </p>
          </div>

          <div className={styles.actions}>
            <Link href={workersExportHref} download className={styles.secondaryAction}>
              Export do Excelu
            </Link>
            <Link href="/workers/new" data-tour="workers-new-button" className={styles.primaryAction}>
              {dictionary.workers.addWorker}
            </Link>
          </div>
        </div>

        <div data-tour="workers-month-filter" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Link href={`/workers?month=${previousMonth}`} style={monthNavButtonStyle}>{dictionary.workers.previousPayroll}</Link>
          <div style={{ padding: '8px 13px', borderRadius: '999px', background: '#f0ecff', color: '#5936c6', fontSize: '14px', fontWeight: 600 }}>{monthLabel}</div>
          <Link href={`/workers?month=${nextMonth}`} style={monthNavButtonStyle}>{dictionary.workers.nextPayroll}</Link>
          <Link href={`/workers?month=${getTodayMonthString()}`} style={monthNavButtonStyle}>{dictionary.workers.currentPayroll}</Link>
        </div>

        <div data-tour="workers-summary" className={styles.summary}>
          <div style={statBoxStyle}><div style={{ fontSize: '12px', color: '#717684', marginBottom: '5px' }}>{dictionary.workers.shiftsForPeriod}</div><div style={{ fontSize: '21px', fontWeight: 600, lineHeight: 1.15 }}>{formatHours(totalPeriodShiftHours)} h</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '12px', color: '#717684', marginBottom: '5px' }}>Celkem na výplaty</div><div style={{ fontSize: '21px', fontWeight: 600, lineHeight: 1.15 }}>{formatCurrency(totalPeriodPayroll)}</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '12px', color: '#717684', marginBottom: '5px' }}>Uhrazeno / zbývá</div><div style={{ fontSize: '21px', fontWeight: 600, lineHeight: 1.15 }}>{formatCurrency(totalPeriodPayrollPaid)} / {formatCurrency(totalPeriodPayrollUnpaid)}</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '12px', color: '#717684', marginBottom: '5px' }}>{dictionary.workers.totalAdvancesForPeriod}</div><div style={{ fontSize: '21px', fontWeight: 600, lineHeight: 1.15 }}>{formatCurrency(totalPeriodAdvances)}</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '12px', color: '#717684', marginBottom: '5px' }}>{dictionary.workers.adminHoursFromJobs}</div><div style={{ fontSize: '21px', fontWeight: 600, lineHeight: 1.15 }}>{formatHours(totalPeriodAssignments)} h</div></div>
        </div>

        {workers.length === 0 ? (
          <div data-tour="workers-list" style={cardStyle}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f0ecff', color: '#16a34a', fontWeight: 600 }}>P</div>
              <div>
                <div style={{ color: '#202534', fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Zatím tu nejsou pracovníci.</div>
                <p style={{ margin: 0, color: '#717684' }}>{dictionary.workers.empty}</p>
                <Link href="/workers/new" data-tour="workers-new-button" className={styles.primaryAction}>
                  {dictionary.workers.addWorker}
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div data-tour="workers-list" className={styles.workerGrid}>
            {workers.map((worker) => {
              const absenceVisual = getAbsenceVisual(worker.absenceState)
              const absenceLabel = getAbsenceLabel(worker.absenceState)

              return (
                <Link key={worker.id} href={`/workers/${worker.id}?month=${selectedMonth}`} className={styles.workerCard} style={{ ...cardStyle, border: `1px solid ${absenceVisual.cardBorder}`, background: '#ffffff' }}>
                  <div className={styles.workerHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#6d4aff', color: '#ffffff', fontSize: '13px', fontWeight: 600, flexShrink: 0 }}>
                        {worker.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      <h2 style={{ margin: 0, fontSize: '19px', lineHeight: '1.2', color: '#202534' }}>{worker.fullName}</h2>
                    </div>
                    <div style={{ display: 'grid', gap: '6px', justifyItems: 'end' }}>
                      <div style={{ background: absenceVisual.badgeBackground, color: absenceVisual.badgeColor, borderRadius: '999px', padding: '6px 9px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{absenceLabel}</div>
                      <div style={{ background: worker.inviteStatus === 'active' ? '#dcfce7' : worker.inviteStatus === 'disabled' ? '#fee2e2' : '#dbeafe', color: worker.inviteStatus === 'active' ? '#166534' : worker.inviteStatus === 'disabled' ? '#991b1b' : '#1d4ed8', borderRadius: '999px', padding: '6px 9px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {worker.inviteStatus === 'active'
                          ? locale === 'cs' ? 'Aktivní' : locale === 'de' ? 'Aktiv' : 'Active'
                          : worker.inviteStatus === 'disabled'
                            ? locale === 'cs' ? 'Přístup vypnutý' : locale === 'de' ? 'Zugang deaktiviert' : 'Access disabled'
                            : locale === 'cs' ? 'Pozván' : locale === 'de' ? 'Eingeladen' : 'Invited'}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '13px', marginBottom: '10px', color: '#4b5563' }}>{worker.email}</div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginBottom: '10px',
                      borderRadius: '999px',
                      border: worker.workerType === 'contractor' ? '1px solid #fed7aa' : '1px solid #bfdbfe',
                      background: worker.workerType === 'contractor' ? '#fff7ed' : '#eff6ff',
                      color: worker.workerType === 'contractor' ? '#9a3412' : '#1d4ed8',
                      padding: '5px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {getWorkerTypeLabel(worker.workerType)}
                  </div>

                  <div className={styles.workerMetrics}>
                    <div style={miniStatStyle}><div style={{ fontSize: '11px', color: '#717684', marginBottom: '4px' }}>{dictionary.workers.shifts}</div><div style={{ fontSize: '17px', fontWeight: 600 }}>{formatHours(worker.shiftHoursMonth)} h</div></div>
                    <div style={miniStatStyle}>
                      <div style={{ fontSize: '11px', color: '#717684', marginBottom: '4px' }}>{dictionary.workers.advancesForThisPayroll}</div>
                      <div style={{ fontSize: '17px', fontWeight: 600 }}>
                        {formatCurrency(worker.advancePaidInPeriod)}
                      </div>
                    </div>
                  </div>

                  <div style={summaryWideBoxStyle}>
                    <div style={{ fontSize: '11px', color: '#717684', marginBottom: '4px' }}>
                      {worker.workerType === 'contractor' ? 'Vyúčtování subdodavatele' : dictionary.workers.totalRewardAfterAdvances}
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 600, lineHeight: 1.1, color: '#202534' }}>{formatCurrency(worker.totalRewardAfterAdvance)}</div>
                    <div style={{ marginTop: '6px', display: 'inline-flex', borderRadius: '999px', padding: '5px 8px', fontSize: '11px', fontWeight: 600, background: worker.payrollPaidAt ? '#dcfce7' : '#fff7ed', color: worker.payrollPaidAt ? '#166534' : '#9a3412' }}>
                      {worker.payrollPaidAt ? 'Výplata uhrazena' : 'Čeká na úhradu'}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '10px', display: 'grid', gap: '6px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span style={{ color: '#717684' }}>{dictionary.workers.defaultHourlyRate}</span><strong>{worker.defaultHourlyRate > 0 ? formatCurrency(worker.defaultHourlyRate) : '-'}</strong></div>
                    <span className={styles.detailHint}>{locale === 'en' ? 'View worker details' : locale === 'de' ? 'Mitarbeiterdetails öffnen' : 'Otevřít detail pracovníka'} <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
