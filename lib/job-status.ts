export type TimeState = 'future' | 'active' | 'finished' | 'unknown'
export type WorkState = 'not_started' | 'in_progress' | 'partially_done' | 'done' | 'unknown'
export type BillingStateResolved =
  | 'waiting_for_invoice'
  | 'due'
  | 'overdue'
  | 'paid'
  | 'unknown'
export type LegacyJobStatus = 'future' | 'in_progress' | 'waiting_check' | 'done'

function getDateKey(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return null

  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]

  const fallback = new Date(normalized)
  if (Number.isNaN(fallback.getTime())) return null

  const year = fallback.getFullYear()
  const month = String(fallback.getMonth() + 1).padStart(2, '0')
  const day = String(fallback.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function isMultiDayJobRange(
  startAt: string | null | undefined,
  endAt: string | null | undefined
) {
  const startDateKey = getDateKey(startAt)
  const endDateKey = getDateKey(endAt)

  if (!startDateKey || !endDateKey) return false
  return startDateKey !== endDateKey
}

export function resolveJobTimeState(value: string | null | undefined): TimeState {
  if (value === 'future' || value === 'active' || value === 'finished') {
    return value
  }

  return 'unknown'
}

export function resolveJobWorkState(value: string | null | undefined): WorkState {
  if (
    value === 'not_started' ||
    value === 'in_progress' ||
    value === 'partially_done' ||
    value === 'done'
  ) {
    return value
  }

  return 'unknown'
}

export function resolveLegacyJobStatus(value: string | null | undefined): LegacyJobStatus | null {
  if (
    value === 'future' ||
    value === 'in_progress' ||
    value === 'waiting_check' ||
    value === 'done'
  ) {
    return value
  }

  return null
}

export function resolveJobBillingState(
  value: string | null | undefined
): BillingStateResolved {
  if (
    value === 'waiting_for_invoice' ||
    value === 'due' ||
    value === 'overdue' ||
    value === 'paid'
  ) {
    return value
  }

  return 'unknown'
}

export function getEffectiveJobWorkState(params: {
  timeState: TimeState
  workState: WorkState
  legacyStatus: LegacyJobStatus | null
  isMultiDay?: boolean
  assignedCount?: number
  startedCount?: number
  completedCount?: number
  activeCount?: number
}): WorkState {
  const {
    timeState,
    workState,
    legacyStatus,
    isMultiDay = false,
    assignedCount = 0,
    startedCount = 0,
    completedCount = 0,
    activeCount = 0,
  } = params

  const hasAnyStartedWork = startedCount > 0 || activeCount > 0
  const hasAnyCompletedWork = completedCount > 0
  const hasAnyWorkSignal =
    hasAnyStartedWork ||
    hasAnyCompletedWork ||
    workState === 'in_progress' ||
    workState === 'partially_done' ||
    workState === 'done'

  if (
    timeState === 'future' &&
    activeCount === 0 &&
    startedCount === 0 &&
    completedCount === 0
  ) {
    return 'not_started'
  }

  // Whole job can be marked as done only by explicit admin action on jobs.status.
  if (legacyStatus === 'done' && (!isMultiDay || timeState === 'finished')) {
    return 'done'
  }

  if (legacyStatus === 'waiting_check') {
    return 'partially_done'
  }

  if (activeCount > 0) {
    return 'in_progress'
  }

  if (hasAnyCompletedWork) {
    return 'partially_done'
  }

  if (hasAnyStartedWork) {
    return 'in_progress'
  }

  if (workState === 'in_progress') {
    return 'in_progress'
  }

  if (workState === 'partially_done') {
    return 'partially_done'
  }

  if (workState === 'done') {
    return 'partially_done'
  }

  if (workState === 'not_started') {
    return 'not_started'
  }

  if (legacyStatus === 'in_progress') {
    return 'in_progress'
  }

  if (legacyStatus === 'future') {
    return 'not_started'
  }

  if (timeState === 'future') {
    return 'not_started'
  }

  if (timeState === 'finished') {
    return hasAnyWorkSignal || assignedCount > 0 ? 'partially_done' : 'not_started'
  }

  if (timeState === 'active') {
    return 'not_started'
  }

  return 'unknown'
}

export function isCompletedJob(workState: WorkState | null | undefined) {
  return workState === 'done'
}

export function getVisibleBillingState(
  workState: WorkState | null | undefined,
  billingState: BillingStateResolved | null | undefined
) {
  if (!billingState || !isCompletedJob(workState)) {
    return null
  }

  return billingState
}
