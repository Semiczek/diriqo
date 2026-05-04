export type LaborCalculationSource = 'shift' | 'assignment_fallback' | 'manual_override'

export type LaborCalculation = {
  hours: number
  hourlyRate: number
  reward: number
  source: LaborCalculationSource
}

type ShiftLike = {
  started_at: string | null
  ended_at: string | null
  hours_override?: number | string | null
  job_hours_override?: number | string | null
}

type AssignmentLike = {
  labor_hours?: number | string | null
  hourly_rate?: number | string | null
  work_started_at?: string | null
  work_completed_at?: string | null
}

export function toFiniteNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function roundLaborHours(value: number): number {
  return Math.round(value * 100) / 100
}

export function getHoursFromRange(startedAt: string | null | undefined, endedAt: string | null | undefined) {
  if (!startedAt || !endedAt) return 0

  const started = new Date(startedAt).getTime()
  const ended = new Date(endedAt).getTime()

  if (Number.isNaN(started) || Number.isNaN(ended) || ended <= started) return 0

  return roundLaborHours((ended - started) / (1000 * 60 * 60))
}

export function getShiftLaborCalculation(shift: ShiftLike, hourlyRate: number): LaborCalculation {
  const manualHours =
    shift.job_hours_override != null
      ? toFiniteNumber(shift.job_hours_override)
      : shift.hours_override != null
        ? toFiniteNumber(shift.hours_override)
        : null
  const hours = manualHours != null ? roundLaborHours(manualHours) : getHoursFromRange(shift.started_at, shift.ended_at)
  const safeRate = toFiniteNumber(hourlyRate)

  return {
    hours,
    hourlyRate: safeRate,
    reward: roundLaborHours(hours * safeRate),
    source: manualHours != null ? 'manual_override' : 'shift',
  }
}

export function getAssignmentFallbackLaborCalculation(
  assignment: AssignmentLike,
  defaultHourlyRate: number
): LaborCalculation {
  const manualHours = assignment.labor_hours != null ? toFiniteNumber(assignment.labor_hours) : null
  const hours =
    manualHours != null && manualHours > 0
      ? roundLaborHours(manualHours)
      : getHoursFromRange(assignment.work_started_at, assignment.work_completed_at)
  const hourlyRate =
    assignment.hourly_rate != null && toFiniteNumber(assignment.hourly_rate) > 0
      ? toFiniteNumber(assignment.hourly_rate)
      : toFiniteNumber(defaultHourlyRate)

  return {
    hours,
    hourlyRate,
    reward: roundLaborHours(hours * hourlyRate),
    source: manualHours != null && manualHours > 0 ? 'manual_override' : 'assignment_fallback',
  }
}
