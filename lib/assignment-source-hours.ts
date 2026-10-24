/** Source time is not approved pay time or billable time. Missing evidence stays unknown. */
export function getRecordedAssignmentHours(assignment: {
  labor_hours?: number | string | null
  work_started_at?: string | null
  work_completed_at?: string | null
}): number | null {
  if (assignment.labor_hours != null) {
    if (typeof assignment.labor_hours === 'string' && !assignment.labor_hours.trim()) return null
    const hours = Number(assignment.labor_hours)
    return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 100) / 100 : null
  }
  if (!assignment.work_started_at || !assignment.work_completed_at) return null
  const start = Date.parse(assignment.work_started_at)
  const end = Date.parse(assignment.work_completed_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round(((end - start) / 3600000) * 100) / 100
}
