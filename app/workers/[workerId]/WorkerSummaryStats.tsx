'use client'

import { useI18n } from '@/components/I18nProvider'
import {
  formatCurrency,
  formatHours,
  statBoxStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'

export default function WorkerSummaryStats({
  totalJobHours,
  totalOutsideJobHours,
  totalShiftHours,
  shiftReward,
  customerCoveredReward,
  companyCoveredReward,
  payrollBonusTotal,
  payrollMealTotal,
  payrollDeductionTotal,
  totalRewardAfterAdvance,
}: {
  totalJobHours: number
  totalOutsideJobHours: number
  totalShiftHours: number
  shiftReward: number
  customerCoveredReward: number
  companyCoveredReward: number
  payrollBonusTotal: number
  payrollMealTotal: number
  payrollDeductionTotal: number
  totalRewardAfterAdvance: number
}) {
  const { dictionary } = useI18n()

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
        marginBottom: '24px',
      }}
    >
      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.shifts}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatHours(totalShiftHours)} h</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.jobsHours}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatHours(totalJobHours)} h</div>
        <div style={{ marginTop: '6px', color: '#6b7280', fontSize: '13px' }}>{formatCurrency(customerCoveredReward)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.outsideJobsHours}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatHours(totalOutsideJobHours)} h</div>
        <div style={{ marginTop: '6px', color: '#6b7280', fontSize: '13px' }}>{formatCurrency(companyCoveredReward)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.shiftsReward}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(shiftReward)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.bonuses}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(payrollBonusTotal)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.mealAllowance}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(payrollMealTotal)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.detail.deductions}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(payrollDeductionTotal)}</div>
      </div>

      <div style={statBoxStyle}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{dictionary.workers.totalRewardAfterAdvances}</div>
        <div style={{ fontSize: '30px', fontWeight: 700 }}>{formatCurrency(totalRewardAfterAdvance)}</div>
      </div>
    </div>
  )
}
