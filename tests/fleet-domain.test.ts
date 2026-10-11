import { describe, expect, it } from 'vitest'
import { allocationTotal, canTransitionTrip, csvCell, mileageAmount, tripConflict } from '../lib/fleet/domain'

const first = { id: 'first', started_at: '2026-04-01T08:00:00Z', ended_at: '2026-04-01T09:00:00Z', odometer_start: 1000, odometer_end: 1100 }
const second = { id: 'second', started_at: '2026-04-01T09:00:00Z', ended_at: '2026-04-01T10:00:00Z', odometer_start: 1100, odometer_end: 1150 }

describe('fleet trip continuity and approval', () => {
  it('accepts adjacent trips but rejects actual time overlaps', () => {
    expect(tripConflict(second, [first], 1000)).toBeNull()
    expect(tripConflict({ ...second, started_at: '2026-04-01T08:59:00Z' }, [first], 1000)).toContain('překrývá')
  })
  it('checks both neighbouring tachometer values when inserting history', () => {
    expect(tripConflict(first, [second], 1000)).toBeNull()
    expect(tripConflict({ ...first, odometer_end: 1099 }, [second], 1000)).toContain('nenavazuje')
    expect(tripConflict({ ...second, odometer_start: 1101 }, [first], 1000)).toContain('nenavazuje')
  })
  it('does not compare a trip to itself when editing', () => expect(tripConflict(first, [first, second], 1000)).toBeNull())
  it('rejects a first-trip gap and reversed time', () => {
    expect(tripConflict({ ...first, odometer_start: 1001 }, [], 1000)).toContain('nenavazuje')
    expect(tripConflict({ ...first, ended_at: first.started_at }, [], 1000)).toContain('Neplatný')
  })
  it('drivers can submit but cannot approve, return, or lock', () => {
    expect(canTransitionTrip('draft', 'submitted', false)).toBe(true)
    expect(canTransitionTrip('submitted', 'approved', false)).toBe(false)
    expect(canTransitionTrip('approved', 'locked', false)).toBe(false)
    expect(canTransitionTrip('submitted', 'draft', false)).toBe(false)
    expect(canTransitionTrip('approved', 'draft', true)).toBe(true)
    expect(canTransitionTrip('locked', 'draft', true)).toBe(false)
    expect(canTransitionTrip('draft', 'locked', true)).toBe(false)
  })
})

describe('fleet cost methodology', () => {
  it('100 km at 10 Kč produces 1000 Kč including fuel', () => {
    expect(mileageAmount(1000, 1100, 10)).toBe(1000)
    expect(() => allocationTotal([1200], 1200, 'mileage')).toThrow('podruhé')
  })
  it('allows two 1000 Kč allocations from one 2000 Kč source and rejects over-allocation', () => {
    expect(allocationTotal([1000, 1000], 2000, 'actual')).toBe(2000)
    expect(() => allocationTotal([1000, 1000.01], 2000, 'actual')).toThrow('přesahuje')
  })
  it('rejects negative or nonfinite monetary input', () => {
    expect(() => mileageAmount(5, 4, 10)).toThrow()
    expect(() => mileageAmount(5, Infinity, 10)).toThrow()
    expect(() => allocationTotal([NaN], 2000, 'actual')).toThrow()
    expect(() => allocationTotal([-2], 2000, 'actual')).toThrow()
  })
  it('handles penny totals without floating point overflow', () => expect(allocationTotal([0.1, 0.2], 0.3, 'actual')).toBe(0.3))
})

describe('fleet CSV export', () => {
  it('escapes quoted delimiters and neutralizes spreadsheet formulas', () => {
    expect(csvCell('Praha; "Brno"')).toBe('"Praha; ""Brno"""')
    expect(csvCell('=IMPORTXML("secret")')).toBe('"\'=IMPORTXML(""secret"")"')
    expect(csvCell('  +1+2')).toBe('"\'  +1+2"')
    expect(csvCell(null)).toBe('""')
  })
})
