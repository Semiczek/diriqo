export type JobShiftActivityRow = {
  job_id: string | null
  shift_date?: string | null
  started_at?: string | null
  ended_at?: string | null
}

export type JobShiftActivitySummary = {
  nextShiftAt: string | null
  lastShiftAt: string | null
  sortAt: string | null
}

function parseDateTime(value: string | null | undefined) {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dateOnly = new Date(`${trimmed}T12:00:00`)
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly
  }

  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toIsoStringOrNull(date: Date | null) {
  return date ? date.toISOString() : null
}

export function getShiftPlannedAt(shift: JobShiftActivityRow) {
  return (
    parseDateTime(shift.started_at) ??
    parseDateTime(shift.shift_date) ??
    parseDateTime(shift.ended_at)
  )
}

export function getShiftActivityAt(shift: JobShiftActivityRow) {
  return (
    parseDateTime(shift.ended_at) ??
    parseDateTime(shift.started_at) ??
    parseDateTime(shift.shift_date)
  )
}

export function getShiftDateKey(shift: Pick<JobShiftActivityRow, 'shift_date' | 'started_at' | 'ended_at'>) {
  const directDate = (shift.shift_date ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(directDate)) {
    return directDate
  }

  const derived =
    getShiftPlannedAt({ job_id: null, ...shift }) ?? getShiftActivityAt({ job_id: null, ...shift })

  if (!derived) return null

  const year = derived.getFullYear()
  const month = String(derived.getMonth() + 1).padStart(2, '0')
  const day = String(derived.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildJobShiftActivityMap(
  shifts: JobShiftActivityRow[],
  now: Date = new Date()
) {
  const summaryByJob = new Map<string, { nextShiftAt: Date | null; lastShiftAt: Date | null }>()

  for (const shift of shifts) {
    if (!shift.job_id) continue

    const plannedAt = getShiftPlannedAt(shift)
    const activityAt = getShiftActivityAt(shift)
    const current =
      summaryByJob.get(shift.job_id) ?? { nextShiftAt: null, lastShiftAt: null }

    if (plannedAt && plannedAt.getTime() >= now.getTime()) {
      if (!current.nextShiftAt || plannedAt.getTime() < current.nextShiftAt.getTime()) {
        current.nextShiftAt = plannedAt
      }
    }

    if (activityAt) {
      if (!current.lastShiftAt || activityAt.getTime() > current.lastShiftAt.getTime()) {
        current.lastShiftAt = activityAt
      }
    }

    summaryByJob.set(shift.job_id, current)
  }

  return new Map<string, JobShiftActivitySummary>(
    Array.from(summaryByJob.entries()).map(([jobId, value]) => [
      jobId,
      {
        nextShiftAt: toIsoStringOrNull(value.nextShiftAt),
        lastShiftAt: toIsoStringOrNull(value.lastShiftAt),
        sortAt: toIsoStringOrNull(value.nextShiftAt ?? value.lastShiftAt),
      },
    ])
  )
}
