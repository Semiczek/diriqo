import { getContractorBillingType, getWorkerType } from '../payroll-settings'

export type WorkerPayrollTypeInput = Parameters<typeof getWorkerType>[0]
export type WorkerPayrollBaseSource = 'shift' | 'job'

export function getWorkerPayrollBaseSource(worker: WorkerPayrollTypeInput): WorkerPayrollBaseSource {
  const workerType = getWorkerType(worker)

  if (workerType === 'contractor' && getContractorBillingType(worker?.contractor_billing_type) !== 'hourly') {
    return 'job'
  }

  return 'shift'
}

export function calculateWorkerPayroll(input: {
  worker: WorkerPayrollTypeInput
  jobReward: number
  shiftReward?: number
  standaloneShiftReward?: number
  bonusTotal: number
  mealTotal: number
  deductionTotal: number
  advanceTotal: number
}) {
  const workerType = getWorkerType(input.worker)
  const isContractor = workerType === 'contractor'
  const baseSource = getWorkerPayrollBaseSource(input.worker)
  const shiftReward = input.shiftReward ?? input.jobReward + (input.standaloneShiftReward ?? 0)
  const baseReward = baseSource === 'job' ? input.jobReward : shiftReward
  const grossReward = baseReward + input.bonusTotal + input.mealTotal - input.deductionTotal
  const advanceTotal = input.advanceTotal
  const netPayout = grossReward - advanceTotal

  return {
    workerType,
    isContractor,
    baseSource,
    baseReward,
    grossReward,
    advanceTotal,
    netPayout,
  }
}
