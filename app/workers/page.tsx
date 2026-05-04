import type { CSSProperties } from 'react'

import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import { getActiveCompanyContext } from '@/lib/active-company'
import { getIntlLocale } from '@/lib/i18n/config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
import {
  getAssignmentFallbackLaborCalculation,
} from '@/lib/labor-calculation'
import { getWorkerType, getWorkerTypeLabel } from '@/lib/payroll-settings'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type WorkersPageProps = {
  searchParams?: Promise<{
    month?: string
  }>
}

const PAYROLL_ADVANCE_START_DAY = 19
const PAYROLL_ADVANCE_END_EXCLUSIVE_DAY = 18
const PAYROLL_ADVANCE_END_VISIBLE_DAY = 17

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
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
  end_at: string | null
}

type JobAssignmentRow = {
  job_id: string | null
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
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

type WorkerAdvanceRow = {
  profile_id: string | null
  amount: number | null
  issued_at: string | null
  note?: string | null
}

type PayrollItemRow = {
  profile_id: string | null
  payroll_month: string | null
  item_type: string | null
  amount: number | string | null
}

type AdvanceRequestPayrollRow = {
  id: string
  profile_id: string | null
  amount: number | string | null
  requested_amount?: number | string | null
  reason?: string | null
  note?: string | null
  status: string | null
  requested_at: string | null
  approved_at: string | null
  reviewed_at: string | null
  paid_at: string | null
  payroll_month: string | null
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
  payrollBonusTotal: number
  payrollMealTotal: number
  payrollDeductionTotal: number
  totalRewardAfterAdvance: number
  absenceState: WorkerAbsenceState
}

type RawJobRelation = {
  id?: string | null
  end_at?: string | null
} | null

type RawJobAssignmentRow = {
  job_id?: string | null
  profile_id?: string | null
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  jobs?: RawJobRelation | RawJobRelation[]
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

function normalizePayrollMonthValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!match) return null
  return `${match[1]}-${match[2]}`
}

function getPayrollMonthFromDateString(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const payrollMonth = new Date(
    date.getFullYear(),
    date.getMonth() + (date.getDate() >= 19 ? 1 : 0),
    1,
    0,
    0,
    0,
    0
  )
  const year = payrollMonth.getFullYear()
  const month = String(payrollMonth.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getAdvanceRequestPayrollMonth(row: AdvanceRequestPayrollRow) {
  return (
    normalizePayrollMonthValue(row.payroll_month) ||
    getPayrollMonthFromDateString(row.paid_at) ||
    getPayrollMonthFromDateString(row.approved_at || row.reviewed_at) ||
    getPayrollMonthFromDateString(row.requested_at)
  )
}

function isAdvanceRequestRepresentedByWorkerAdvance(
  row: AdvanceRequestPayrollRow,
  workerAdvances: WorkerAdvanceRow[]
) {
  const requestRef = `(${row.id})`
  return workerAdvances.some(
    (advance) =>
      advance.profile_id === row.profile_id &&
      typeof advance.note === 'string' &&
      advance.note.includes(requestRef)
  )
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

function getAdvanceRange(monthString: string, locale: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const advanceStart = new Date(year, monthIndex, PAYROLL_ADVANCE_START_DAY, 0, 0, 0, 0)
  const advanceEndExclusive = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)
  const advanceEndVisible = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_VISIBLE_DAY, 0, 0, 0, 0)
  const payDate = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)

  const formatDateLabel = (value: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(value)

  return {
    advanceStartDate: formatLocalDateKey(advanceStart),
    advanceEndExclusiveDate: formatLocalDateKey(advanceEndExclusive),
    payDateLabel: formatDateLabel(payDate),
    advancePeriodLabel: `${formatDateLabel(advanceStart)} - ${formatDateLabel(advanceEndVisible)}`,
    monthLabel: new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, monthIndex, 1, 0, 0, 0, 0)),
  }
}

function isDateInDateKeyRange(value: string | null | undefined, startDate: string, endExclusiveDate: string) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const dateKey = formatLocalDateKey(date)
  return dateKey >= startDate && dateKey < endExclusiveDate
}

function normalizeJobAssignments(data: RawJobAssignmentRow[]): JobAssignmentRow[] {
  return data.map((item) => {
    const rawJob = Array.isArray(item?.jobs) ? item.jobs[0] ?? null : item?.jobs ?? null

    return {
      job_id: item?.job_id ?? rawJob?.id ?? null,
      profile_id: item?.profile_id ?? null,
      labor_hours: item?.labor_hours != null ? Number(item.labor_hours) : null,
      hourly_rate: item?.hourly_rate != null ? Number(item.hourly_rate) : null,
      jobs: rawJob
        ? {
            id: rawJob.id ?? '',
            end_at: rawJob.end_at ?? null,
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

export default async function WorkersPage({ searchParams }: WorkersPageProps) {
  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()
  const intlLocale = getIntlLocale(locale)

  const formatHours = (value: number) =>
    new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(value)

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
  const { advanceStartDate, advanceEndExclusiveDate, payDateLabel, advancePeriodLabel, monthLabel } =
    getAdvanceRange(selectedMonth, intlLocale)

  const previousMonth = shiftMonth(selectedMonth, -1)
  const nextMonth = shiftMonth(selectedMonth, 1)

  const activeCompany = await getActiveCompanyContext()
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
    workLogsResponse,
    workShiftsResponse,
    workerAdvancesResponse,
    advanceRequestsResponse,
    payrollItemsResponse,
    absencesResponse,
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, default_hourly_rate, advance_paid, worker_type, contractor_billing_type, contractor_default_rate').in('id', profileIds).order('full_name', { ascending: true }),
    supabase.from('job_assignments').select(`
      profile_id,
      job_id,
      labor_hours,
      hourly_rate,
      jobs!inner (
        id,
        end_at
      )
    `).in('profile_id', profileIds).is('archived_at', null).gte('jobs.end_at', workStartIso).lt('jobs.end_at', workEndExclusiveIso),
    supabase.from('work_logs').select('profile_id, hours, work_date').in('profile_id', profileIds).gte('work_date', workStartDate).lt('work_date', workEndExclusiveDate),
    supabase.from('work_shifts').select('id, profile_id, job_id, shift_date, started_at, ended_at, hours_override, job_hours_override').in('profile_id', profileIds).gte('shift_date', workStartDate).lt('shift_date', workEndExclusiveDate).order('started_at', { ascending: false }),
    supabase.from('worker_advances').select('profile_id, amount, issued_at, note').in('profile_id', profileIds).gte('issued_at', advanceStartDate).lt('issued_at', advanceEndExclusiveDate),
    supabase
      .from('advance_requests')
      .select('id, profile_id, amount, requested_amount, reason, note, status, requested_at, approved_at, reviewed_at, paid_at, payroll_month')
      .in('profile_id', profileIds)
      .eq('status', 'paid'),
    supabase
      .from('payroll_items')
      .select('profile_id, payroll_month, item_type, amount')
      .in('profile_id', profileIds)
      .eq('payroll_month', selectedMonth),
    supabase.from('absence_requests').select('id, profile_id, absence_mode, absence_type, start_at, end_at, status').in('profile_id', profileIds).eq('status', 'approved'),
  ])

  if (profilesResponse.error) return renderError(`${dictionary.workers.profilesLoadError}: ${profilesResponse.error.message}`)
  if (jobAssignmentsResponse.error) return renderError(`${dictionary.workers.assignmentsLoadError}: ${jobAssignmentsResponse.error.message}`)
  if (workLogsResponse.error) return renderError(`${dictionary.workers.workLogsLoadError}: ${workLogsResponse.error.message}`)
  if (workShiftsResponse.error) return renderError(`${dictionary.workers.shiftsLoadError}: ${workShiftsResponse.error.message}`)
  if (workerAdvancesResponse.error) return renderError(`${dictionary.workers.advancesLoadError}: ${workerAdvancesResponse.error.message}`)
  if (advanceRequestsResponse.error) return renderError(`${dictionary.workers.advancesLoadError}: ${advanceRequestsResponse.error.message}`)
  if (payrollItemsResponse.error) return renderError(`${dictionary.workers.detail.loadPayrollItemsFailed}: ${payrollItemsResponse.error.message}`)
  if (absencesResponse.error) return renderError(`${dictionary.workers.absencesLoadError}: ${absencesResponse.error.message}`)

  const profiles = (profilesResponse.data ?? []) as ProfileRow[]
  const jobAssignments = normalizeJobAssignments((jobAssignmentsResponse.data ?? []) as RawJobAssignmentRow[])
  const workLogs = (workLogsResponse.data ?? []) as WorkLogRow[]
  const workShifts = (workShiftsResponse.data ?? []) as WorkShiftRow[]
  const workerAdvances = (workerAdvancesResponse.data ?? []) as WorkerAdvanceRow[]
  const paidAdvanceRequests = ((advanceRequestsResponse.data ?? []) as unknown[] as AdvanceRequestPayrollRow[]).filter(
    (item) => isDateInDateKeyRange(item.paid_at, advanceStartDate, advanceEndExclusiveDate)
  )
  const payrollItems = ((payrollItemsResponse.data ?? []) as unknown[]) as PayrollItemRow[]
  const absences = (absencesResponse.data ?? []) as AbsenceRow[]

  const now = new Date()

  const workers: WorkerCardData[] = profiles.map((profile) => {
    const workerJobAssignments = jobAssignments.filter((item) => item.profile_id === profile.id)
    const workerWorkLogs = workLogs.filter((item) => item.profile_id === profile.id)
    const workerShifts = workShifts.filter((item) => item.profile_id === profile.id)
    const workerAdvanceRows = workerAdvances.filter((item) => item.profile_id === profile.id)
    const workerPaidAdvanceRequests = paidAdvanceRequests.filter(
      (item) => item.profile_id === profile.id && !isAdvanceRequestRepresentedByWorkerAdvance(item, workerAdvanceRows)
    )
    const workerPayrollItems = payrollItems.filter((item) => item.profile_id === profile.id)
    const workerAbsences = absences.filter((item) => item.profile_id === profile.id)
    const workerType = getWorkerType(profile)
    const isContractor = workerType === 'contractor'

    const shiftJobKeys = new Set(
      workerShifts
        .filter((shift) => shift.job_id)
        .map((shift) => `${profile.id}:${shift.job_id}`)
    )
    const defaultHourlyRate = Number(profile.default_hourly_rate ?? 0)
    const shiftCalculations = workerShifts.map((shift) => {
      const hours = getEffectiveShiftHours(shift)
      return {
        hours,
        reward: hours * defaultHourlyRate,
      }
    })
    const fallbackCalculations = workerJobAssignments
      .filter((assignment) => assignment.job_id && !shiftJobKeys.has(`${profile.id}:${assignment.job_id}`))
      .map((assignment) => getAssignmentFallbackLaborCalculation(assignment, defaultHourlyRate))
      .filter((calculation) => calculation.hours > 0)
    const jobAssignmentHours = workerJobAssignments
      .map((assignment) => getAssignmentFallbackLaborCalculation(assignment, defaultHourlyRate))
      .reduce((sum, item) => sum + item.hours, 0)
    const jobAssignmentReward = fallbackCalculations.reduce((sum, item) => sum + item.reward, 0)
    const workLogHours = workerWorkLogs.reduce((sum, item) => sum + Number(item.hours ?? 0), 0)
    const shiftHoursMonth = shiftCalculations.reduce((sum, item) => sum + item.hours, 0)
    const shiftReward = shiftCalculations.reduce((sum, item) => sum + item.reward, 0)
    const payrollReward = isContractor ? jobAssignmentReward : shiftReward
    const advancePaidInPeriod =
      isContractor
        ? 0
        : workerAdvanceRows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0) +
          workerPaidAdvanceRequests.reduce((sum, item) => sum + Number(item.amount ?? item.requested_amount ?? 0), 0)
    const payrollBonusTotal = workerPayrollItems
      .filter((item) => item.item_type === 'bonus')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const payrollMealTotal = workerPayrollItems
      .filter((item) => item.item_type === 'meal')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const payrollDeductionTotal = workerPayrollItems
      .filter((item) => item.item_type === 'deduction')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const totalRewardAfterAdvance =
      payrollReward + payrollBonusTotal + payrollMealTotal - payrollDeductionTotal - advancePaidInPeriod
    const absenceState = getWorkerAbsenceState(workerAbsences, now)

    return {
      id: profile.id,
      workerType,
      fullName: getWorkerName(profile, dictionary.workers.unnamedWorker),
      email: profile.email ?? '-',
      defaultHourlyRate,
      advancePaidInPeriod,
      jobAssignmentHours,
      jobAssignmentReward,
      workLogHours,
      shiftHoursMonth,
      shiftReward,
      payrollBonusTotal,
      payrollMealTotal,
      payrollDeductionTotal,
      totalRewardAfterAdvance,
      absenceState,
    }
  })

  const totalPeriodShiftHours = workers.reduce((sum, worker) => sum + worker.shiftHoursMonth, 0)
  const totalPeriodAssignments = workers.reduce((sum, worker) => sum + worker.jobAssignmentHours, 0)
  const totalPeriodAdvances = workers.reduce((sum, worker) => sum + worker.advancePaidInPeriod, 0)

  const cardStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '24px', padding: '24px', background: 'linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)', color: '#111827', textDecoration: 'none', display: 'block', boxShadow: '0 18px 40px rgba(15, 23, 42, 0.07)' }
  const statBoxStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '22px', padding: '20px', background: 'linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)', boxShadow: '0 16px 34px rgba(15, 23, 42, 0.055)' }
  const miniStatStyle: CSSProperties = { border: '1px solid rgba(226, 232, 240, 0.9)', borderRadius: '16px', padding: '13px', background: '#f8fafc' }
  const summaryWideBoxStyle: CSSProperties = { border: '1px solid rgba(203, 213, 225, 0.9)', borderRadius: '18px', padding: '15px 16px', background: '#f8fafc', marginBottom: '14px' }
  const monthNavButtonStyle: CSSProperties = { display: 'inline-flex', padding: '10px 14px', borderRadius: '999px', background: '#ffffff', color: '#111827', textDecoration: 'none', fontWeight: 800, border: '1px solid #e5e7eb', whiteSpace: 'nowrap', boxShadow: '0 10px 22px rgba(15,23,42,0.05)' }

  return (
    <DashboardShell activeItem="workers">
      <main style={{ maxWidth: '1100px', color: '#111827' }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '18px', marginBottom: '22px', flexWrap: 'wrap', padding: '28px', borderRadius: '28px', background: 'linear-gradient(135deg, rgba(240,253,250,0.96) 0%, rgba(239,246,255,0.94) 52%, rgba(250,245,255,0.9) 100%)', border: '1px solid rgba(203, 213, 225, 0.78)', boxShadow: '0 22px 58px rgba(15, 23, 42, 0.10)' }}>
          <div>
            <div style={{ display: 'inline-flex', marginBottom: '12px', padding: '7px 11px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.72)', border: '1px solid rgba(6,182,212,0.22)', color: '#0e7490', fontSize: '12px', fontWeight: 900 }}>
              Tým
            </div>
            <h1 style={{ margin: 0, fontSize: '44px', lineHeight: '1.05', fontWeight: 850, color: '#0f172a' }}>{dictionary.workers.title}</h1>
            <p style={{ margin: '10px 0 0 0', color: '#475569', fontSize: '15px', lineHeight: 1.6 }}>
              {dictionary.workers.workingMonth}: {workPeriodLabel}. {dictionary.workers.advancesForPayroll}: {advancePeriodLabel}. {dictionary.workers.payrollDue}: {payDateLabel}.
            </p>
          </div>

          <Link href="/workers/new" style={{ display: 'inline-flex', padding: '13px 18px', borderRadius: '999px', background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#ffffff', textDecoration: 'none', fontWeight: 900, boxShadow: '0 16px 34px rgba(37, 99, 235, 0.22)' }}>
            {dictionary.workers.addWorker}
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <Link href={`/workers?month=${previousMonth}`} style={monthNavButtonStyle}>{dictionary.workers.previousPayroll}</Link>
          <div style={{ padding: '10px 16px', borderRadius: '999px', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', color: '#ffffff', fontWeight: 800 }}>{monthLabel}</div>
          <Link href={`/workers?month=${nextMonth}`} style={monthNavButtonStyle}>{dictionary.workers.nextPayroll}</Link>
          <Link href={`/workers?month=${getTodayMonthString()}`} style={monthNavButtonStyle}>{dictionary.workers.currentPayroll}</Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <div style={statBoxStyle}><div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.shiftsForPeriod}</div><div style={{ fontSize: '30px', fontWeight: 700 }}>{formatHours(totalPeriodShiftHours)} h</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.totalAdvancesForPeriod}</div><div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(totalPeriodAdvances)}</div></div>
          <div style={statBoxStyle}><div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.adminHoursFromJobs}</div><div style={{ fontSize: '30px', fontWeight: 700 }}>{formatHours(totalPeriodAssignments)} h</div></div>
        </div>

        {workers.length === 0 ? (
          <div style={cardStyle}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(22,163,74,0.14), rgba(6,182,212,0.16))', color: '#16a34a', fontWeight: 950 }}>P</div>
              <div>
                <div style={{ color: '#0f172a', fontSize: '18px', fontWeight: 850, marginBottom: '4px' }}>Zatím tu nejsou pracovníci.</div>
                <p style={{ margin: 0, color: '#6b7280' }}>{dictionary.workers.empty}</p>
                <Link href="/workers/new" style={{ display: 'inline-flex', marginTop: '12px', padding: '9px 12px', borderRadius: '999px', background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#ffffff', textDecoration: 'none', fontSize: '13px', fontWeight: 900 }}>
                  {dictionary.workers.addWorker}
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {workers.map((worker) => {
              const absenceVisual = getAbsenceVisual(worker.absenceState)
              const absenceLabel = getAbsenceLabel(worker.absenceState)

              return (
                <Link key={worker.id} href={`/workers/${worker.id}?month=${selectedMonth}`} style={{ ...cardStyle, border: `1px solid ${absenceVisual.cardBorder}`, background: `linear-gradient(145deg, ${absenceVisual.cardBackground} 0%, #ffffff 100%)` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div style={{ width: '46px', height: '46px', borderRadius: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#ffffff', fontWeight: 950, flexShrink: 0 }}>
                        {worker.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      <h2 style={{ margin: 0, fontSize: '22px', lineHeight: '1.2', color: '#111827' }}>{worker.fullName}</h2>
                    </div>
                    <div style={{ background: absenceVisual.badgeBackground, color: absenceVisual.badgeColor, borderRadius: '999px', padding: '8px 12px', fontSize: '12px', fontWeight: 800, whiteSpace: 'nowrap' }}>{absenceLabel}</div>
                  </div>

                  <div style={{ fontSize: '15px', marginBottom: '14px', color: '#4b5563' }}>{worker.email}</div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginBottom: '14px',
                      borderRadius: '999px',
                      border: worker.workerType === 'contractor' ? '1px solid #fed7aa' : '1px solid #bfdbfe',
                      background: worker.workerType === 'contractor' ? '#fff7ed' : '#eff6ff',
                      color: worker.workerType === 'contractor' ? '#9a3412' : '#1d4ed8',
                      padding: '6px 10px',
                      fontSize: '12px',
                      fontWeight: 900,
                    }}
                  >
                    {getWorkerTypeLabel(worker.workerType)}
                  </div>

                  <div style={{ ...summaryWideBoxStyle, background: absenceVisual.accentBackground, border: `1px solid ${absenceVisual.cardBorder}` }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.workerStatus}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: absenceVisual.badgeColor, lineHeight: 1.1 }}>{absenceLabel}</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div style={miniStatStyle}><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.shifts}</div><div style={{ fontSize: '20px', fontWeight: 700 }}>{formatHours(worker.shiftHoursMonth)} h</div></div>
                    <div style={miniStatStyle}><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.workLogs}</div><div style={{ fontSize: '20px', fontWeight: 700 }}>{formatHours(worker.workLogHours)} h</div></div>
                    <div style={miniStatStyle}><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.adminHours}</div><div style={{ fontSize: '20px', fontWeight: 700 }}>{formatHours(worker.jobAssignmentHours)} h</div></div>
                    <div style={miniStatStyle}>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.advancesForThisPayroll}</div>
                      <div style={{ fontSize: '20px', fontWeight: 700 }}>
                        {worker.workerType === 'contractor' ? '-' : formatCurrency(worker.advancePaidInPeriod)}
                      </div>
                    </div>
                  </div>

                  <div style={summaryWideBoxStyle}>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>
                      {worker.workerType === 'contractor' ? 'Vyuctovani subdodavatele' : dictionary.workers.totalRewardAfterAdvances}
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.1, color: '#111827' }}>{formatCurrency(worker.totalRewardAfterAdvance)}</div>
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                      {worker.workerType === 'contractor'
                        ? `Externi prace ${formatCurrency(worker.jobAssignmentReward)} - zalohy se nepouzivaji`
                        : `${dictionary.workers.shifts} ${formatCurrency(worker.shiftReward)} - ${dictionary.workers.advancesForThisPayroll.toLowerCase()} ${formatCurrency(worker.advancePaidInPeriod)}`}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', display: 'grid', gap: '8px', fontSize: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span style={{ color: '#6b7280' }}>{dictionary.workers.defaultHourlyRate}</span><strong>{worker.defaultHourlyRate > 0 ? formatCurrency(worker.defaultHourlyRate) : '-'}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span style={{ color: '#6b7280' }}>{dictionary.workers.workPeriod}</span><strong>{workPeriodLabel}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span style={{ color: '#6b7280' }}>{dictionary.workers.advancesPeriod}</span><strong>{worker.workerType === 'contractor' ? 'Nepouziva se' : advancePeriodLabel}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span style={{ color: '#6b7280' }}>{dictionary.workers.payrollDueLabel}</span><strong>{worker.workerType === 'contractor' ? 'Nepouziva se' : payDateLabel}</strong></div>
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
