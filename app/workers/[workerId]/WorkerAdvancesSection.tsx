'use client'

import { useI18n } from '@/components/I18nProvider'
import type { WorkerAdvanceRow } from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  boxStyle,
  formatCurrency,
  formatDate,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import { cardTitleStyle, sectionCardStyle } from '@/components/SaasPageLayout'

export default function WorkerAdvancesSection({
  advancePeriodLabel,
  workerAdvances,
}: {
  advancePeriodLabel: string
  workerAdvances: WorkerAdvanceRow[]
}) {
  const { dictionary } = useI18n()
  const t = dictionary.workers.detail

  return (
    <section style={sectionCardStyle}>
      <h2 style={{ ...cardTitleStyle, marginBottom: '16px' }}>{t.advances} ({advancePeriodLabel})</h2>

      {workerAdvances.length === 0 ? (
        <div style={boxStyle}>
          <p style={{ margin: 0, color: '#6b7280' }}>{t.noAdvances}</p>
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.issueDate}</th>
                <th style={thStyle}>{t.amount}</th>
                <th style={thStyle}>{dictionary.jobs.detail.note}</th>
              </tr>
            </thead>
            <tbody>
              {workerAdvances.map((advance, index) => (
                <tr key={`${advance.id ?? 'advance'}-${index}`}>
                  <td style={tdStyle}>{formatDate(advance.issued_at)}</td>
                  <td style={tdStyle}>{formatCurrency(Number(advance.amount ?? 0))}</td>
                  <td style={tdStyle}>{advance.note?.trim() ? advance.note : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
