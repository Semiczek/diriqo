import { describe, expect, it } from 'vitest'

import { calculateWorkerPayroll } from '../lib/payroll/worker-payroll'

describe('worker payroll', () => {
  it('uses shifts as the payroll base for internal workers', () => {
    const payroll = calculateWorkerPayroll({
      worker: { worker_type: 'employee' },
      jobReward: 12000,
      shiftReward: 16000,
      bonusTotal: 1000,
      mealTotal: 500,
      deductionTotal: 300,
      advanceTotal: 2000,
    })

    expect(payroll.baseSource).toBe('shift')
    expect(payroll.grossReward).toBe(17200)
    expect(payroll.netPayout).toBe(15200)
  })

  it('uses shifts as the payroll base for hourly contractors', () => {
    const payroll = calculateWorkerPayroll({
      worker: { worker_type: 'contractor', contractor_billing_type: 'hourly' },
      jobReward: 12000,
      shiftReward: 16000,
      bonusTotal: 1000,
      mealTotal: 500,
      deductionTotal: 300,
      advanceTotal: 2000,
    })

    expect(payroll.baseSource).toBe('shift')
    expect(payroll.netPayout).toBe(15200)
  })

  it('uses job reward only for non-hourly contractor billing', () => {
    const payroll = calculateWorkerPayroll({
      worker: { worker_type: 'contractor', contractor_billing_type: 'fixed_per_job' },
      jobReward: 12000,
      shiftReward: 16000,
      bonusTotal: 1000,
      mealTotal: 500,
      deductionTotal: 300,
      advanceTotal: 2000,
    })

    expect(payroll.baseSource).toBe('job')
    expect(payroll.grossReward).toBe(13200)
    expect(payroll.netPayout).toBe(11200)
  })
})
