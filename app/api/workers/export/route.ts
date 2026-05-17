import { NextRequest, NextResponse } from 'next/server'

import { createExportWorkbook, styleExportWorksheet, workbookXlsxResponse } from '@/lib/excel-export'
import { getContractorBillingType, getWorkerType } from '@/lib/payroll-settings'
import { calculateWorkerPayroll } from '@/lib/payroll/worker-payroll'
import { requireHubAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  doesDateRangeOverlap,
  formatDateForExport,
  getAdvanceRange,
  getEffectiveShiftHours,
  getWorkerDisplayName,
  getWorkMonthRange,
  numberOrZero,
  resolveExportMonth,
} from '@/lib/workers-export-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CompanyMemberRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  role: string | null
  is_active: boolean | null
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
  default_hourly_rate: number | string | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | string | null
}

type JobRelation = {
  id: string
  title: string | null
  address: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
}

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
  jobs?: JobRelation | JobRelation[] | null
}

type JobAssignmentRow = {
  id: string | null
  job_id: string | null
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
  worker_type_snapshot: string | null
  assignment_billing_type: string | null
  external_amount: number | null
  work_started_at: string | null
  work_completed_at: string | null
  effective_hours: number | null
  effective_rate: number | null
  effective_reward: number | null
  jobs: JobRelation | null
}

type JobAssignmentSummaryRow = {
  assignment_id: string | null
  job_id: string | null
  profile_id: string | null
  labor_hours_total: number | string | null
  effective_hourly_rate: number | string | null
  labor_cost_total: number | string | null
}

type WorkLogRow = {
  profile_id: string | null
  hours: number | string | null
}

type WorkShiftRow = {
  id: string
  profile_id: string | null
  job_id: string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | string | null
}

type WorkerAdvanceRow = {
  profile_id: string | null
  amount: number | string | null
}

type PayrollItemRow = {
  profile_id: string | null
  item_type: string | null
  amount: number | string | null
}

type AdvanceRequestRow = {
  profile_id: string | null
  amount: number | string | null
  requested_amount?: number | string | null
  status: string | null
  paid_at: string | null
  approved_at: string | null
  reviewed_at: string | null
}

type PayrollPaymentRow = {
  profile_id: string | null
  amount: number | string | null
  paid_at: string | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function normalizeAssignments(rows: RawJobAssignmentRow[]): JobAssignmentRow[] {
  return rows.map((row) => ({
    id: row.id ?? null,
    job_id: row.job_id ?? null,
    profile_id: row.profile_id ?? null,
    labor_hours: row.labor_hours != null ? numberOrZero(row.labor_hours) : null,
    hourly_rate: row.hourly_rate != null ? numberOrZero(row.hourly_rate) : null,
    worker_type_snapshot: row.worker_type_snapshot ?? null,
    assignment_billing_type: row.assignment_billing_type ?? null,
    external_amount: row.external_amount != null ? numberOrZero(row.external_amount) : null,
    work_started_at: row.work_started_at ?? null,
    work_completed_at: row.work_completed_at ?? null,
    effective_hours: null,
    effective_rate: null,
    effective_reward: null,
    jobs: asSingle(row.jobs),
  }))
}

function getEffectiveAssignmentHours(assignment: JobAssignmentRow) {
  if (assignment.effective_hours != null && assignment.effective_hours > 0) return assignment.effective_hours
  if (assignment.labor_hours != null && assignment.labor_hours > 0) return assignment.labor_hours
  if (!assignment.work_started_at || !assignment.work_completed_at) return 0

  const start = new Date(assignment.work_started_at).getTime()
  const end = new Date(assignment.work_completed_at).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.round(((end - start) / 1000 / 60 / 60) * 100) / 100
}

function getEffectiveAssignmentRate(assignment: JobAssignmentRow, defaultRate: number) {
  if (assignment.effective_rate != null && assignment.effective_rate > 0) return assignment.effective_rate
  if (assignment.hourly_rate != null && assignment.hourly_rate > 0) return assignment.hourly_rate
  return defaultRate
}

function getEffectiveAssignmentReward(assignment: JobAssignmentRow, defaultRate: number, worker: ProfileRow) {
  const workerType = getWorkerType({
    worker_type: assignment.worker_type_snapshot ?? worker.worker_type,
  })
  const billingType = getContractorBillingType(assignment.assignment_billing_type ?? worker.contractor_billing_type)

  if (workerType === 'contractor' && billingType !== 'hourly' && assignment.external_amount != null) {
    return assignment.external_amount
  }

  return getEffectiveAssignmentHours(assignment) * getEffectiveAssignmentRate(assignment, defaultRate)
}

function getDefaultHourlyRate(profile: ProfileRow) {
  const workerType = getWorkerType(profile)
  return numberOrZero(
    workerType === 'contractor'
      ? profile.contractor_default_rate ?? profile.default_hourly_rate
      : profile.default_hourly_rate,
  )
}

function isDateInDateKeyRange(value: string | null | undefined, startDate: string, endExclusiveDate: string) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return key >= startDate && key < endExclusiveDate
}

function isMissingPayrollPaymentsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message ?? '').toLowerCase()
  return error?.code === '42P01' || message.includes('payroll_payments')
}

function getInviteStatus(profile: ProfileRow) {
  if (profile.disabled_at || profile.worker_status === 'disabled') return 'Vypnuto'
  if (profile.activated_at || profile.worker_status === 'active') return 'Aktivní'
  return 'Pozván'
}

function getWorkerTypeText(profile: ProfileRow) {
  return getWorkerType(profile) === 'contractor' ? 'Externí / subdodavatel' : 'Interní pracovník'
}

export async function GET(request: NextRequest) {
  const guard = await requireHubAccess()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const selectedMonth = resolveExportMonth(request.nextUrl.searchParams.get('month'))
  const { workStartDate, workEndExclusiveDate, workStartIso, workEndExclusiveIso, workPeriodLabel } =
    getWorkMonthRange(selectedMonth)
  const { advanceStartDate, advanceEndExclusiveDate, advancePeriodLabel, payDateLabel } =
    getAdvanceRange(selectedMonth)
  const supabase = await createSupabaseServerClient()

  const membersResponse = await supabase
    .from('company_members')
    .select('id, company_id, profile_id, role, is_active')
    .eq('company_id', guard.value.companyId)
    .eq('is_active', true)

  if (membersResponse.error) {
    return NextResponse.json({ error: membersResponse.error.message }, { status: 400 })
  }

  const members = (membersResponse.data ?? []) as CompanyMemberRow[]
  const memberByProfileId = new Map(
    members
      .filter((member) => member.profile_id)
      .map((member) => [member.profile_id as string, member]),
  )
  const profileIds = Array.from(memberByProfileId.keys())

  const workbook = createExportWorkbook(`Pracovníci ${selectedMonth}`)
  const worksheet = workbook.addWorksheet('Pracovníci')
  worksheet.columns = [
    { header: 'Pracovní měsíc', key: 'workPeriod', width: 24 },
    { header: 'Období záloh', key: 'advancePeriod', width: 24 },
    { header: 'Splatnost výplaty', key: 'payDate', width: 18 },
    { header: 'Jméno', key: 'name', width: 28 },
    { header: 'E-mail', key: 'email', width: 30 },
    { header: 'Telefon', key: 'phone', width: 18 },
    { header: 'Role v týmu', key: 'role', width: 18 },
    { header: 'Typ pracovníka', key: 'workerType', width: 22 },
    { header: 'Stav pozvánky', key: 'inviteStatus', width: 18 },
    { header: 'Aktivace', key: 'activatedAt', width: 14 },
    { header: 'Směny h', key: 'shiftHours', width: 12 },
    { header: 'Work logy h', key: 'workLogHours', width: 12 },
    { header: 'Hodiny ze zakázek h', key: 'jobHours', width: 18 },
    { header: 'Odměna ze směn Kč', key: 'shiftReward', width: 18 },
    { header: 'Náklady zakázek Kč', key: 'jobReward', width: 18 },
    { header: 'Bonusy Kč', key: 'bonusTotal', width: 14 },
    { header: 'Stravné Kč', key: 'mealTotal', width: 14 },
    { header: 'Srážky Kč', key: 'deductionTotal', width: 14 },
    { header: 'Zálohy Kč', key: 'advanceTotal', width: 14 },
    { header: 'Celkem k výplatě Kč', key: 'netPayout', width: 20 },
    { header: 'Uhrazeno Kč', key: 'paidAmount', width: 14 },
    { header: 'Uhrazeno dne', key: 'paidAt', width: 16 },
  ]

  if (profileIds.length === 0) {
    styleExportWorksheet(worksheet)
    return workbookXlsxResponse(workbook, `pracovnici-${selectedMonth}`)
  }

  const [
    profilesResponse,
    jobAssignmentsResponse,
    jobAssignmentSummariesResponse,
    workLogsResponse,
    workShiftsResponse,
    workerAdvancesResponse,
    advanceRequestsResponse,
    payrollItemsResponse,
    payrollPaymentsResponse,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, worker_status, activated_at, disabled_at, last_seen_at, device_registered_at, default_hourly_rate, worker_type, contractor_billing_type, contractor_default_rate')
      .in('id', profileIds)
      .order('full_name', { ascending: true }),
    supabase
      .from('job_assignments')
      .select(`
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
          end_at
        )
      `)
      .in('profile_id', profileIds)
      .is('archived_at', null),
    supabase
      .from('worker_job_assignment_summary')
      .select('assignment_id, job_id, profile_id, labor_hours_total, effective_hourly_rate, labor_cost_total')
      .in('profile_id', profileIds),
    supabase
      .from('work_logs')
      .select('profile_id, hours')
      .in('profile_id', profileIds)
      .gte('work_date', workStartDate)
      .lt('work_date', workEndExclusiveDate),
    supabase
      .from('work_shifts')
      .select('id, profile_id, job_id, shift_date, started_at, ended_at, hours_override')
      .eq('company_id', guard.value.companyId)
      .in('profile_id', profileIds)
      .gte('shift_date', workStartDate)
      .lt('shift_date', workEndExclusiveDate),
    supabase
      .from('worker_advances')
      .select('profile_id, amount')
      .in('profile_id', profileIds)
      .gte('issued_at', advanceStartDate)
      .lt('issued_at', advanceEndExclusiveDate),
    supabase
      .from('advance_requests')
      .select('profile_id, amount, requested_amount, status, paid_at, approved_at, reviewed_at')
      .in('profile_id', profileIds)
      .eq('status', 'paid'),
    supabase
      .from('payroll_items')
      .select('profile_id, item_type, amount')
      .in('profile_id', profileIds)
      .eq('payroll_month', selectedMonth),
    supabase
      .from('payroll_payments')
      .select('profile_id, amount, paid_at')
      .in('profile_id', profileIds)
      .eq('payroll_month', selectedMonth),
  ])

  if (profilesResponse.error) return NextResponse.json({ error: profilesResponse.error.message }, { status: 400 })
  if (jobAssignmentsResponse.error) return NextResponse.json({ error: jobAssignmentsResponse.error.message }, { status: 400 })
  if (jobAssignmentSummariesResponse.error) return NextResponse.json({ error: jobAssignmentSummariesResponse.error.message }, { status: 400 })
  if (workLogsResponse.error) return NextResponse.json({ error: workLogsResponse.error.message }, { status: 400 })
  if (workShiftsResponse.error) return NextResponse.json({ error: workShiftsResponse.error.message }, { status: 400 })
  if (workerAdvancesResponse.error) return NextResponse.json({ error: workerAdvancesResponse.error.message }, { status: 400 })
  if (advanceRequestsResponse.error) return NextResponse.json({ error: advanceRequestsResponse.error.message }, { status: 400 })
  if (payrollItemsResponse.error) return NextResponse.json({ error: payrollItemsResponse.error.message }, { status: 400 })
  if (payrollPaymentsResponse.error && !isMissingPayrollPaymentsTable(payrollPaymentsResponse.error)) {
    return NextResponse.json({ error: payrollPaymentsResponse.error.message }, { status: 400 })
  }

  const summariesByAssignmentId = new Map(
    ((jobAssignmentSummariesResponse.data ?? []) as JobAssignmentSummaryRow[])
      .filter((summary) => summary.assignment_id)
      .map((summary) => [
        summary.assignment_id as string,
        {
          effective_hours: summary.labor_hours_total != null ? numberOrZero(summary.labor_hours_total) : null,
          effective_rate: summary.effective_hourly_rate != null ? numberOrZero(summary.effective_hourly_rate) : null,
          effective_reward: summary.labor_cost_total != null ? numberOrZero(summary.labor_cost_total) : null,
        },
      ]),
  )
  const assignments = normalizeAssignments((jobAssignmentsResponse.data ?? []) as RawJobAssignmentRow[]).map((assignment) => {
    const summary = assignment.id ? summariesByAssignmentId.get(assignment.id) ?? null : null
    return {
      ...assignment,
      effective_hours: summary?.effective_hours ?? null,
      effective_rate: summary?.effective_rate ?? null,
      effective_reward: summary?.effective_reward ?? null,
    }
  })
  const workLogs = (workLogsResponse.data ?? []) as WorkLogRow[]
  const workShifts = (workShiftsResponse.data ?? []) as WorkShiftRow[]
  const workerAdvances = (workerAdvancesResponse.data ?? []) as WorkerAdvanceRow[]
  const paidAdvanceRequests = ((advanceRequestsResponse.data ?? []) as AdvanceRequestRow[]).filter((request) =>
    isDateInDateKeyRange(request.paid_at || request.approved_at || request.reviewed_at, advanceStartDate, advanceEndExclusiveDate),
  )
  const payrollItems = (payrollItemsResponse.data ?? []) as PayrollItemRow[]
  const payrollPayments = payrollPaymentsResponse.error
    ? []
    : ((payrollPaymentsResponse.data ?? []) as PayrollPaymentRow[])

  for (const profile of (profilesResponse.data ?? []) as ProfileRow[]) {
    const member = memberByProfileId.get(profile.id)
    const defaultHourlyRate = getDefaultHourlyRate(profile)
    const workerAssignments = assignments.filter((assignment) => {
      if (assignment.profile_id !== profile.id) return false
      const hasShiftInMonth = workShifts.some(
        (shift) => shift.profile_id === profile.id && shift.job_id != null && shift.job_id === assignment.job_id,
      )

      return (
        doesDateRangeOverlap(assignment.jobs?.start_at, assignment.jobs?.end_at, workStartIso, workEndExclusiveIso) ||
        doesDateRangeOverlap(assignment.work_started_at, assignment.work_completed_at, workStartIso, workEndExclusiveIso) ||
        hasShiftInMonth
      )
    })
    const assignmentRateByJobId = new Map(
      workerAssignments
        .filter((assignment) => assignment.job_id)
        .map((assignment) => [assignment.job_id as string, getEffectiveAssignmentRate(assignment, defaultHourlyRate)]),
    )
    const workerShifts = workShifts.filter((shift) => shift.profile_id === profile.id)
    const shiftReward = workerShifts.reduce((sum, shift) => {
      const hours = getEffectiveShiftHours(shift)
      const rate = shift.job_id ? assignmentRateByJobId.get(shift.job_id) ?? defaultHourlyRate : defaultHourlyRate
      return sum + hours * rate
    }, 0)
    const shiftHours = workerShifts.reduce((sum, shift) => sum + getEffectiveShiftHours(shift), 0)
    const jobHours = workerAssignments.reduce((sum, assignment) => sum + getEffectiveAssignmentHours(assignment), 0)
    const jobReward = workerAssignments.reduce(
      (sum, assignment) => sum + getEffectiveAssignmentReward(assignment, defaultHourlyRate, profile),
      0,
    )
    const workLogHours = workLogs
      .filter((log) => log.profile_id === profile.id)
      .reduce((sum, log) => sum + numberOrZero(log.hours), 0)
    const advanceTotal =
      workerAdvances
        .filter((advance) => advance.profile_id === profile.id)
        .reduce((sum, advance) => sum + numberOrZero(advance.amount), 0) +
      paidAdvanceRequests
        .filter((advance) => advance.profile_id === profile.id)
        .reduce((sum, advance) => sum + numberOrZero(advance.amount ?? advance.requested_amount), 0)
    const workerPayrollItems = payrollItems.filter((item) => item.profile_id === profile.id)
    const bonusTotal = workerPayrollItems
      .filter((item) => item.item_type === 'bonus')
      .reduce((sum, item) => sum + numberOrZero(item.amount), 0)
    const mealTotal = workerPayrollItems
      .filter((item) => item.item_type === 'meal')
      .reduce((sum, item) => sum + numberOrZero(item.amount), 0)
    const deductionTotal = workerPayrollItems
      .filter((item) => item.item_type === 'deduction')
      .reduce((sum, item) => sum + numberOrZero(item.amount), 0)
    const payroll = calculateWorkerPayroll({
      worker: profile,
      jobReward,
      shiftReward,
      bonusTotal,
      mealTotal,
      deductionTotal,
      advanceTotal,
    })
    const payment = payrollPayments.find((item) => item.profile_id === profile.id)

    worksheet.addRow({
      workPeriod: workPeriodLabel,
      advancePeriod: advancePeriodLabel,
      payDate: getWorkerType(profile) === 'contractor' ? 'Podle vyúčtování' : payDateLabel,
      name: getWorkerDisplayName(profile),
      email: profile.email ?? '',
      phone: profile.phone ?? '',
      role: member?.role ?? '',
      workerType: getWorkerTypeText(profile),
      inviteStatus: getInviteStatus(profile),
      activatedAt: formatDateForExport(profile.activated_at),
      shiftHours,
      workLogHours,
      jobHours,
      shiftReward,
      jobReward,
      bonusTotal,
      mealTotal,
      deductionTotal,
      advanceTotal,
      netPayout: payroll.netPayout,
      paidAmount: numberOrZero(payment?.amount),
      paidAt: formatDateForExport(payment?.paid_at),
    })
  }

  for (const key of ['shiftHours', 'workLogHours', 'jobHours']) {
    worksheet.getColumn(key).numFmt = '0.00'
  }
  for (const key of ['shiftReward', 'jobReward', 'bonusTotal', 'mealTotal', 'deductionTotal', 'advanceTotal', 'netPayout', 'paidAmount']) {
    worksheet.getColumn(key).numFmt = '# ##0 Kč'
  }
  styleExportWorksheet(worksheet)

  return workbookXlsxResponse(workbook, `pracovnici-${selectedMonth}`)
}
