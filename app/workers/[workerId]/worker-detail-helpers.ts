import type { CSSProperties } from 'react'

import {
  getCappedJobShiftLaborCalculation,
  type LaborCalculationSource,
} from '@/lib/labor-calculation'
import { getContractorBillingType, getWorkerType } from '@/lib/payroll-settings'
import {
  cardStyle,
  sectionCardStyle,
  secondaryButtonStyle,
} from '@/components/SaasPageLayout'

export type WorkerDetailPageProps = {
  params: Promise<{
    workerId: string
  }>
  searchParams?: Promise<{
    month?: string
    invite?: string
  }>
}

export type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone?: string | null
  worker_status?: string | null
  activated_at?: string | null
  last_seen_at?: string | null
  device_registered_at?: string | null
  disabled_at?: string | null
  default_hourly_rate: number | null
  advance_paid: number | null
  worker_type?: string | null
  use_custom_payroll?: boolean | null
  custom_payroll_type?: string | null
  custom_payroll_day_of_month?: number | null
  custom_payroll_weekday?: number | null
  custom_payroll_anchor_date?: string | null
  allow_advances_override?: boolean | null
  advance_limit_amount_override?: number | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | null
}

export type CompanyMemberRow = {
  company_id: string | null
}

export type JobRelation = {
  id: string
  company_id?: string | null
  customer_name?: string | null
  title: string | null
  address: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  price: number | null
  is_paid: boolean | null
  time_state?: string | null
  work_state?: string | null
}

export type JobAssignmentRow = {
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

export type WorkerJobAssignmentSummaryRow = {
  assignment_id: string
  job_id: string | null
  profile_id: string | null
  labor_hours_total: number | null
  effective_hourly_rate: number | null
  labor_cost_total: number | null
}

export type WorkShiftRow = {
  id: string
  profile_id: string | null
  company_id: string | null
  job_id: string | null
  job_hours_override: number | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | null
  note: string | null
}

export type WorkerDailyJobRow = {
  key: string
  work_date: string
  hours: number
  hourly_rate: number
  reward: number
  source: LaborCalculationSource
  has_shift_coverage: boolean
  linked_shift_id: string | null
  jobs: JobRelation | null
}

export type ShiftJobOption = {
  id: string
  title: string | null
  start_at?: string | null
  end_at?: string | null
}

export type WorkerAdvanceRow = {
  id?: string
  profile_id: string | null
  amount: number | null
  issued_at: string | null
  note: string | null
}

export type PayrollItemType = 'bonus' | 'meal' | 'deduction'

export type PayrollItemRow = {
  id?: string
  profile_id: string | null
  payroll_month: string | null
  item_type: PayrollItemType | string | null
  amount: number | string | null
  note: string | null
  created_at?: string | null
}

export type AdvanceRequestPayrollRow = {
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

type RowRecord = Record<string, unknown>

const PAYROLL_ADVANCE_START_DAY = 19
const PAYROLL_ADVANCE_END_EXCLUSIVE_DAY = 18
const PAYROLL_ADVANCE_END_VISIBLE_DAY = 17

export function isMissingWorkShiftAssignmentColumn(message: string | undefined) {
  const lowerMessage = (message ?? '').toLowerCase()
  return (
    lowerMessage.includes('work_shifts.job_id') ||
    lowerMessage.includes('work_shifts.job_hours_override')
  )
}

export function formatHours(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function getLocalDateKey(value: string | Date | null | undefined) {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateLabel(value: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value)
}

function formatLocalDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getShiftHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return 0

  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()

  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  if (end <= start) return 0

  return (end - start) / (1000 * 60 * 60)
}

export function getEffectiveShiftHours(shift: WorkShiftRow) {
  if (shift.hours_override != null) {
    return Number(shift.hours_override)
  }

  return getShiftHours(shift.started_at, shift.ended_at)
}

export function getEffectiveAllocatedShiftJobHours(shift: WorkShiftRow) {
  if (!shift.job_id) return 0

  if (shift.job_hours_override != null) {
    return Number(shift.job_hours_override)
  }

  return getEffectiveShiftHours(shift)
}

export function getEffectiveAssignmentHours(assignment: JobAssignmentRow) {
  if (assignment.effective_hours != null && Number(assignment.effective_hours) > 0) {
    return Number(assignment.effective_hours)
  }

  if (assignment.labor_hours != null && Number(assignment.labor_hours) > 0) {
    return Number(assignment.labor_hours)
  }

  if (!assignment.work_started_at || !assignment.work_completed_at) return 0

  const start = new Date(assignment.work_started_at)
  const end = new Date(assignment.work_completed_at)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0

  return Math.round((diffMs / 1000 / 60 / 60) * 100) / 100
}

export function getEffectiveAssignmentRate(assignment: JobAssignmentRow, defaultRate: number) {
  if (assignment.effective_rate != null && Number(assignment.effective_rate) > 0) {
    return Number(assignment.effective_rate)
  }

  if (assignment.hourly_rate != null && Number(assignment.hourly_rate) > 0) {
    return Number(assignment.hourly_rate)
  }

  return Number(defaultRate ?? 0)
}

export function getEffectiveAssignmentReward(
  assignment: JobAssignmentRow,
  defaultRate: number,
  worker?: Pick<ProfileRow, 'worker_type' | 'contractor_billing_type'> | null,
) {
  const workerType = getWorkerType({
    worker_type: assignment.worker_type_snapshot ?? worker?.worker_type,
  })
  const billingType = getContractorBillingType(
    assignment.assignment_billing_type ?? worker?.contractor_billing_type,
  )

  if (workerType === 'contractor' && billingType !== 'hourly' && assignment.external_amount != null) {
    return Number(assignment.external_amount)
  }

  return getEffectiveAssignmentHours(assignment) * getEffectiveAssignmentRate(assignment, defaultRate)
}

export function getWorkerName(profile: ProfileRow) {
  if (profile.full_name && profile.full_name.trim()) {
    return profile.full_name.trim()
  }

  if (profile.email && profile.email.trim()) {
    return profile.email.trim()
  }

  return 'Bez jména'
}

export function isValidMonthString(value: string | undefined) {
  if (!value) return false
  return /^\d{4}-\d{2}$/.test(value)
}

export function getTodayMonthString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function shiftMonth(monthString: string, diff: number) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const date = new Date(year, monthIndex + diff, 1, 0, 0, 0, 0)

  const newYear = date.getFullYear()
  const newMonth = String(date.getMonth() + 1).padStart(2, '0')

  return `${newYear}-${newMonth}`
}

export function normalizePayrollMonthValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!match) return null
  return `${match[1]}-${match[2]}`
}

export function getPayrollMonthFromDateString(value: string | null | undefined) {
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
    0,
  )
  const year = payrollMonth.getFullYear()
  const month = String(payrollMonth.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function getAdvanceRequestPayrollMonth(row: AdvanceRequestPayrollRow) {
  return (
    normalizePayrollMonthValue(row.payroll_month) ||
    getPayrollMonthFromDateString(row.paid_at) ||
    getPayrollMonthFromDateString(row.approved_at || row.reviewed_at) ||
    getPayrollMonthFromDateString(row.requested_at)
  )
}

export function isAdvanceRequestRepresentedByWorkerAdvance(
  row: AdvanceRequestPayrollRow,
  workerAdvances: WorkerAdvanceRow[],
) {
  const requestRef = `(${row.id})`
  return workerAdvances.some(
    (advance) =>
      advance.profile_id === row.profile_id &&
      typeof advance.note === 'string' &&
      advance.note.includes(requestRef),
  )
}

export function mapAdvanceRequestToWorkerAdvance(row: AdvanceRequestPayrollRow): WorkerAdvanceRow {
  const amount = Number(row.amount ?? row.requested_amount ?? 0)
  const issuedAt = row.paid_at || row.approved_at || row.reviewed_at || row.requested_at
  const cleanNote = (row.reason || row.note || '').trim()

  return {
    id: `advance-request-${row.id}`,
    profile_id: row.profile_id,
    amount: Number.isFinite(amount) ? amount : 0,
    issued_at: issuedAt ? issuedAt.slice(0, 10) : null,
    note: cleanNote ? `Vyplaceno z žádosti o zálohu (${row.id}) – ${cleanNote}` : `Vyplaceno z žádosti o zálohu (${row.id})`,
  }
}

export function getWorkMonthRange(monthString: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const workStart = new Date(year, monthIndex, 1, 0, 0, 0, 0)
  const workEndExclusive = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0)
  const workEndVisible = new Date(year, monthIndex + 1, 0, 0, 0, 0, 0)

  return {
    workStartDate: formatLocalDateKey(workStart),
    workEndExclusiveDate: formatLocalDateKey(workEndExclusive),
    workStartIso: workStart.toISOString(),
    workEndExclusiveIso: workEndExclusive.toISOString(),
    workPeriodLabel: `${formatDateLabel(workStart)} – ${formatDateLabel(workEndVisible)}`,
  }
}

export function getAdvanceRange(monthString: string) {
  const [yearString, monthStringPart] = monthString.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthStringPart) - 1

  const advanceStart = new Date(year, monthIndex, PAYROLL_ADVANCE_START_DAY, 0, 0, 0, 0)
  const advanceEndExclusive = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)
  const advanceEndVisible = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_VISIBLE_DAY, 0, 0, 0, 0)
  const payDate = new Date(year, monthIndex + 1, PAYROLL_ADVANCE_END_EXCLUSIVE_DAY, 0, 0, 0, 0)

  return {
    advanceStartDate: formatLocalDateKey(advanceStart),
    advanceEndExclusiveDate: formatLocalDateKey(advanceEndExclusive),
    advanceStartIso: advanceStart.toISOString(),
    advanceEndExclusiveIso: advanceEndExclusive.toISOString(),
    payDateLabel: formatDateLabel(payDate),
    advancePeriodLabel: `${formatDateLabel(advanceStart)} – ${formatDateLabel(advanceEndVisible)}`,
    monthLabel: new Intl.DateTimeFormat('cs-CZ', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, monthIndex, 1, 0, 0, 0, 0)),
  }
}

export function isDateInRange(value: string | null | undefined, startIso: string, endIso: string) {
  if (!value) return false

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false

  const time = date.getTime()
  return time >= new Date(startIso).getTime() && time < new Date(endIso).getTime()
}

export function doesDateRangeOverlap(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  rangeStartIso: string,
  rangeEndExclusiveIso: string,
) {
  const start = startValue ? new Date(startValue) : null
  const end = endValue ? new Date(endValue) : null
  const rangeStart = new Date(rangeStartIso)
  const rangeEndExclusive = new Date(rangeEndExclusiveIso)

  if (!start || Number.isNaN(start.getTime())) {
    return end ? isDateInRange(endValue, rangeStartIso, rangeEndExclusiveIso) : false
  }

  const effectiveEnd = !end || Number.isNaN(end.getTime()) ? start : end
  return start.getTime() < rangeEndExclusive.getTime() && effectiveEnd.getTime() >= rangeStart.getTime()
}

function getDateKeysInRange(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  rangeStartIso: string,
  rangeEndExclusiveIso: string,
) {
  const rangeStart = new Date(rangeStartIso)
  const rangeEndExclusive = new Date(rangeEndExclusiveIso)
  const start = startValue ? new Date(startValue) : null
  const end = endValue ? new Date(endValue) : null

  if (!start || Number.isNaN(start.getTime())) return []

  const effectiveEnd = !end || Number.isNaN(end.getTime()) ? start : end

  const cursor = new Date(
    Math.max(
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime(),
      new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime(),
    ),
  )
  const finalDay = new Date(
    Math.min(
      new Date(effectiveEnd.getFullYear(), effectiveEnd.getMonth(), effectiveEnd.getDate()).getTime(),
      new Date(rangeEndExclusive.getFullYear(), rangeEndExclusive.getMonth(), rangeEndExclusive.getDate() - 1).getTime(),
    ),
  )

  if (cursor.getTime() > finalDay.getTime()) return []

  const keys: string[] = []
  while (cursor.getTime() <= finalDay.getTime()) {
    const key = getLocalDateKey(cursor)
    if (key) keys.push(key)
    cursor.setDate(cursor.getDate() + 1)
  }

  return keys
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100
}

export function buildWorkerDailyJobRows({
  assignments,
  workShifts,
  shiftJobs = [],
  defaultRate,
  workStartIso,
  workEndExclusiveIso,
}: {
  assignments: JobAssignmentRow[]
  workShifts: WorkShiftRow[]
  shiftJobs?: ShiftJobOption[]
  defaultRate: number
  workStartIso: string
  workEndExclusiveIso: string
}): WorkerDailyJobRow[] {
  if (workShifts.length > 0) {
    const assignmentByJobId = new Map(
      assignments
        .filter((assignment) => assignment.job_id && assignment.jobs)
        .map((assignment) => [assignment.job_id as string, assignment.jobs as JobRelation])
    )
    const assignmentRateByJobId = new Map(
      assignments
        .filter((assignment) => assignment.job_id)
        .map((assignment) => [assignment.job_id as string, getEffectiveAssignmentRate(assignment, defaultRate)])
    )
    const shiftJobById = new Map(shiftJobs.map((job) => [job.id, job]))
    const shiftRows = workShifts
      .flatMap<WorkerDailyJobRow>((shift) => {
        if (!shift.job_id) return []

        const dateKey = shift.shift_date ?? getLocalDateKey(shift.started_at) ?? getLocalDateKey(shift.ended_at)
        if (!dateKey) return []

        const calculation = getCappedJobShiftLaborCalculation(
          shift,
          assignmentRateByJobId.get(shift.job_id) ?? defaultRate
        )
        const hours = calculation.hours
        if (hours <= 0) return []

        const assignedJob = shift.job_id ? assignmentByJobId.get(shift.job_id) ?? null : null
        const shiftJob = shift.job_id ? shiftJobById.get(shift.job_id) ?? null : null
        const job =
          assignedJob ??
          (shiftJob
            ? {
                id: shiftJob.id,
                company_id: shift.company_id,
                title: shiftJob.title,
                address: null,
                status: null,
                start_at: shiftJob.start_at ?? null,
                end_at: shiftJob.end_at ?? null,
                price: null,
                is_paid: null,
              }
            : null)

        return [
          {
            key: `shift:${shift.id}`,
            work_date: dateKey,
            hours,
            hourly_rate: calculation.hourlyRate,
            reward: calculation.reward,
            source: calculation.source,
            has_shift_coverage: true,
            linked_shift_id: shift.id,
            jobs: job,
          },
        ]
      })
      .sort((a, b) => {
        const dateDiff = new Date(a.work_date).getTime() - new Date(b.work_date).getTime()
        if (dateDiff !== 0) return dateDiff
        return (a.jobs?.title ?? '').localeCompare(b.jobs?.title ?? '', 'cs')
      })

    return shiftRows
  }

  const shiftHoursByDate = new Map<string, number>()
  const remainingShiftHoursByDate = new Map<string, number>()
  const shiftHoursByJobAndDate = new Map<string, number>()
  const firstShiftIdByJobAndDate = new Map<string, string>()

  for (const shift of workShifts) {
    const dateKey = shift.shift_date ?? getLocalDateKey(shift.started_at) ?? getLocalDateKey(shift.ended_at)
    if (!dateKey) continue

    const effectiveShiftHours = getEffectiveShiftHours(shift)
    shiftHoursByDate.set(dateKey, roundHours((shiftHoursByDate.get(dateKey) ?? 0) + effectiveShiftHours))
    remainingShiftHoursByDate.set(
      dateKey,
      roundHours((remainingShiftHoursByDate.get(dateKey) ?? 0) + effectiveShiftHours),
    )

    if (shift.job_id) {
      const jobKey = `${shift.job_id}:${dateKey}`
      shiftHoursByJobAndDate.set(
        jobKey,
        roundHours((shiftHoursByJobAndDate.get(jobKey) ?? 0) + getEffectiveAllocatedShiftJobHours(shift)),
      )
      if (!firstShiftIdByJobAndDate.has(jobKey) && shift.id) {
        firstShiftIdByJobAndDate.set(jobKey, shift.id)
      }
    }
  }

  const rows: WorkerDailyJobRow[] = []

  const sortedAssignments = [...assignments].sort((a, b) => {
    const aTime = a.jobs?.start_at ? new Date(a.jobs.start_at).getTime() : 0
    const bTime = b.jobs?.start_at ? new Date(b.jobs.start_at).getTime() : 0
    return aTime - bTime
  })

  for (const assignment of sortedAssignments) {
    const totalHours = roundHours(getEffectiveAssignmentHours(assignment))
    if (totalHours <= 0) continue

    const hourlyRate = getEffectiveAssignmentRate(assignment, defaultRate)
    const jobId = assignment.job_id

    let dayKeys = getDateKeysInRange(
      assignment.jobs?.start_at ?? assignment.work_started_at ?? null,
      assignment.jobs?.end_at ?? assignment.work_completed_at ?? assignment.jobs?.start_at ?? null,
      workStartIso,
      workEndExclusiveIso,
    )

    if (dayKeys.length === 0 && jobId) {
      dayKeys = Array.from(
        new Set(
          workShifts
            .filter((shift) => shift.job_id === jobId)
            .map((shift) => shift.shift_date ?? getLocalDateKey(shift.started_at) ?? getLocalDateKey(shift.ended_at))
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort()
    }

    if (dayKeys.length === 0) {
      const fallbackKey =
        getLocalDateKey(assignment.jobs?.start_at ?? null) ??
        getLocalDateKey(assignment.jobs?.end_at ?? null) ??
        getLocalDateKey(assignment.work_started_at ?? null) ??
        getLocalDateKey(assignment.work_completed_at ?? null) ??
        getLocalDateKey(workStartIso)

      if (fallbackKey) dayKeys = [fallbackKey]
    }

    let remainingHours = totalHours
    const dayAllocations = new Map<string, number>()

    if (jobId) {
      for (const dayKey of dayKeys) {
        if (remainingHours <= 0) break

        const exactShiftHours = shiftHoursByJobAndDate.get(`${jobId}:${dayKey}`) ?? 0
        if (exactShiftHours <= 0) continue

        const allocated = Math.min(remainingHours, exactShiftHours)
        dayAllocations.set(dayKey, roundHours((dayAllocations.get(dayKey) ?? 0) + allocated))
        remainingHours = roundHours(remainingHours - allocated)
        remainingShiftHoursByDate.set(
          dayKey,
          roundHours(Math.max(0, (remainingShiftHoursByDate.get(dayKey) ?? 0) - allocated)),
        )
      }
    }

    const daysWithRemainingShiftCapacity = dayKeys.filter((dayKey) => (remainingShiftHoursByDate.get(dayKey) ?? 0) > 0)
    for (let index = 0; index < daysWithRemainingShiftCapacity.length && remainingHours > 0; index += 1) {
      const dayKey = daysWithRemainingShiftCapacity[index]
      const capacity = remainingShiftHoursByDate.get(dayKey) ?? 0
      if (capacity <= 0) continue

      const daysLeft = daysWithRemainingShiftCapacity.length - index
      const proposed = remainingHours / daysLeft
      const allocated = Math.min(capacity, proposed)

      dayAllocations.set(dayKey, roundHours((dayAllocations.get(dayKey) ?? 0) + allocated))
      remainingHours = roundHours(remainingHours - allocated)
      remainingShiftHoursByDate.set(dayKey, roundHours(Math.max(0, capacity - allocated)))
    }

    if (remainingHours > 0 && dayKeys.length > 0) {
      const unmatchedPerDay = remainingHours / dayKeys.length
      for (const dayKey of dayKeys) {
        dayAllocations.set(dayKey, roundHours((dayAllocations.get(dayKey) ?? 0) + unmatchedPerDay))
      }
      remainingHours = 0
    }

    for (const dayKey of dayKeys) {
      const hours = roundHours(dayAllocations.get(dayKey) ?? 0)
      if (hours <= 0) continue

      const exactShiftHours = jobId ? shiftHoursByJobAndDate.get(`${jobId}:${dayKey}`) ?? 0 : 0
      const totalShiftHoursForDay = shiftHoursByDate.get(dayKey) ?? 0
      const hasShiftCoverage = totalShiftHoursForDay > 0
      const source: WorkerDailyJobRow['source'] =
        exactShiftHours > 0
          ? 'shift'
          : assignment.labor_hours != null && Number(assignment.labor_hours) > 0
            ? 'manual_override'
            : 'assignment_fallback'

      rows.push({
        key: `${jobId ?? 'job'}:${dayKey}`,
        work_date: dayKey,
        hours,
        hourly_rate: hourlyRate,
        reward: roundHours(hours * hourlyRate),
        source,
        has_shift_coverage: hasShiftCoverage,
        linked_shift_id: jobId ? firstShiftIdByJobAndDate.get(`${jobId}:${dayKey}`) ?? null : null,
        jobs: assignment.jobs,
      })
    }
  }

  rows.sort((a, b) => {
    const dateDiff = new Date(a.work_date).getTime() - new Date(b.work_date).getTime()
    if (dateDiff !== 0) return dateDiff
    return (a.jobs?.title ?? '').localeCompare(b.jobs?.title ?? '', 'cs')
  })

  return rows
}

function getRowRecord(value: unknown): RowRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as RowRecord
}

export function normalizeJobRelation(value: unknown): JobRelation | null {
  const rawValue = Array.isArray(value) ? value[0] ?? null : value ?? null
  const rawJob = getRowRecord(rawValue)

  if (!rawJob) return null

  return {
    id: typeof rawJob.id === 'string' ? rawJob.id : '',
    company_id: typeof rawJob.company_id === 'string' ? rawJob.company_id : null,
    customer_name:
      typeof getRowRecord(rawJob.customers)?.name === 'string'
        ? (getRowRecord(rawJob.customers)?.name as string)
        : null,
    title: typeof rawJob.title === 'string' ? rawJob.title : null,
    address: typeof rawJob.address === 'string' ? rawJob.address : null,
    status: typeof rawJob.status === 'string' ? rawJob.status : null,
    start_at: typeof rawJob.start_at === 'string' ? rawJob.start_at : null,
    end_at: typeof rawJob.end_at === 'string' ? rawJob.end_at : null,
    price:
      typeof rawJob.price === 'number' || typeof rawJob.price === 'string'
        ? Number(rawJob.price)
        : null,
    is_paid: typeof rawJob.is_paid === 'boolean' ? rawJob.is_paid : null,
  }
}

export function normalizeJobAssignments(data: unknown[]): JobAssignmentRow[] {
  return data.map((item) => ({
    id: getRowRecord(item)?.id as string | undefined,
    job_id: typeof getRowRecord(item)?.job_id === 'string' ? (getRowRecord(item)?.job_id as string) : null,
    profile_id:
      typeof getRowRecord(item)?.profile_id === 'string'
        ? (getRowRecord(item)?.profile_id as string)
        : null,
    labor_hours:
      getRowRecord(item)?.labor_hours != null ? Number(getRowRecord(item)?.labor_hours) : null,
    hourly_rate:
      getRowRecord(item)?.hourly_rate != null ? Number(getRowRecord(item)?.hourly_rate) : null,
    worker_type_snapshot:
      typeof getRowRecord(item)?.worker_type_snapshot === 'string'
        ? (getRowRecord(item)?.worker_type_snapshot as string)
        : null,
    assignment_billing_type:
      typeof getRowRecord(item)?.assignment_billing_type === 'string'
        ? (getRowRecord(item)?.assignment_billing_type as string)
        : null,
    external_amount:
      getRowRecord(item)?.external_amount != null ? Number(getRowRecord(item)?.external_amount) : null,
    work_started_at:
      typeof getRowRecord(item)?.work_started_at === 'string'
        ? (getRowRecord(item)?.work_started_at as string)
        : null,
    work_completed_at:
      typeof getRowRecord(item)?.work_completed_at === 'string'
        ? (getRowRecord(item)?.work_completed_at as string)
        : null,
    effective_hours: null,
    effective_rate: null,
    effective_reward: null,
    jobs: normalizeJobRelation(getRowRecord(item)?.jobs),
  }))
}

export const boxStyle: CSSProperties = {
  ...sectionCardStyle,
}

export const statBoxStyle: CSSProperties = {
  ...cardStyle,
  padding: '18px',
  position: 'relative',
  overflow: 'hidden',
}

export const sectionTitleStyle: CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '24px',
  lineHeight: 1.2,
  color: '#111827',
}

export const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '20px',
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)',
}

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '820px',
}

export const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: '13px',
  color: '#64748b',
  fontWeight: 850,
  padding: '14px 16px',
  borderBottom: '1px solid rgba(226, 232, 240, 0.9)',
  background: '#f8fafc',
}

export const tdStyle: CSSProperties = {
  padding: '14px 16px',
  borderBottom: '1px solid rgba(226, 232, 240, 0.85)',
  fontSize: '14px',
  color: '#0f172a',
  verticalAlign: 'top',
}

export const monthNavButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  whiteSpace: 'nowrap',
}
