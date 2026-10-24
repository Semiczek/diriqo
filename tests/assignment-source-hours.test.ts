import { describe, expect, it } from 'vitest'
import { getRecordedAssignmentHours } from '../lib/assignment-source-hours'

describe('recorded assignment hours', () => {
  const range = { work_started_at: '2026-10-24T08:00:00Z', work_completed_at: '2026-10-24T16:00:00Z' }
  it('keeps explicit zero and decimal hours independent of elapsed, payable and billed time', () => {
    expect(getRecordedAssignmentHours({ ...range, labor_hours: 0 })).toBe(0)
    expect(getRecordedAssignmentHours({ ...range, labor_hours: '6.25' })).toBe(6.25)
  })
  it('only derives time from a complete valid range when a source override is absent', () => {
    expect(getRecordedAssignmentHours(range)).toBe(8)
    expect(getRecordedAssignmentHours({ work_started_at: range.work_started_at })).toBeNull()
    expect(getRecordedAssignmentHours({})).toBeNull()
    expect(getRecordedAssignmentHours({ ...range, work_completed_at: 'invalid' })).toBeNull()
    expect(getRecordedAssignmentHours({ ...range, work_completed_at: '2026-10-23T16:00:00Z' })).toBeNull()
  })
  it.each(['', ' ', 'invalid', Number.NaN, Number.POSITIVE_INFINITY, -1])('does not hide invalid explicit source hours %s with a fallback', labor_hours => {
    expect(getRecordedAssignmentHours({ ...range, labor_hours })).toBeNull()
  })
})
