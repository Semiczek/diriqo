import { describe, expect, it } from 'vitest'

import {
  getCappedJobShiftLaborCalculation,
  getShiftLaborCalculation,
} from '../lib/labor-calculation'

describe('labor calculation', () => {
  it('caps job hours by the real shift hours', () => {
    const shift = {
      started_at: '2026-05-01T08:00:00.000Z',
      ended_at: '2026-05-01T10:00:00.000Z',
      hours_override: null,
      job_hours_override: 5,
    }

    expect(getShiftLaborCalculation(shift, 100).hours).toBe(5)
    expect(getCappedJobShiftLaborCalculation(shift, 100)).toMatchObject({
      hours: 2,
      reward: 200,
    })
  })

  it('uses the shift duration for job hours when no job override exists', () => {
    expect(
      getCappedJobShiftLaborCalculation(
        {
          started_at: '2026-05-01T08:00:00.000Z',
          ended_at: '2026-05-01T11:30:00.000Z',
          hours_override: null,
          job_hours_override: null,
        },
        100,
      ).hours,
    ).toBe(3.5)
  })
})
