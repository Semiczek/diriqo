import { getWorkerType } from '@/lib/payroll-settings'

export type WorkerPayrollTypeInput = Parameters<typeof getWorkerType>[0]

export function calculateWorkerPayroll(input: {
  worker: WorkerPayrollTypeInput
  jobReward: number
  standaloneShiftReward: number
  bonusTotal: number
  mealTotal: number
  deductionTotal: number
  advanceTotal: number
}) {
  const workerType = getWorkerType(input.worker)
  const isContractor = workerType === 'contractor'
  const grossReward = isContractor
    ? input.jobReward
    : input.jobReward + input.standaloneShiftReward + input.bonusTotal + input.mealTotal - input.deductionTotal
  const advanceTotal = isContractor ? 0 : input.advanceTotal
  const netPayout = grossReward - advanceTotal

  return {
    workerType,
    isContractor,
    grossReward,
    advanceTotal,
    netPayout,
  }
}
