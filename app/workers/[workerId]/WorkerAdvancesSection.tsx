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
  selectedMonth,
  workerId,
  workerAdvances,
  advancesAllowed,
  advanceLimitAmount,
  totalAdvances,
  createAdvanceAction,
  deleteAdvanceAction,
}: {
  advancePeriodLabel: string
  selectedMonth: string
  workerId: string
  workerAdvances: WorkerAdvanceRow[]
  advancesAllowed: boolean
  advanceLimitAmount: number | null
  totalAdvances: number
  createAdvanceAction: (formData: FormData) => void | Promise<void>
  deleteAdvanceAction: (formData: FormData) => void | Promise<void>
}) {
  const { dictionary } = useI18n()
  const t = dictionary.workers.detail
  const finance = dictionary.workers.financeEdit
  const remainingAdvanceLimit =
    advanceLimitAmount != null ? Math.max(0, advanceLimitAmount - totalAdvances) : null
  const todayDate = new Date().toISOString().slice(0, 10)

  return (
    <section style={sectionCardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '18px',
        }}
      >
        <div>
          <h2 style={{ ...cardTitleStyle, margin: 0 }}>{t.advances} ({advancePeriodLabel})</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '14px', lineHeight: 1.5 }}>
            Zálohy se ukládají přímo do přehledu pracovníka a počítají se do výplaty podle nastavení.
          </p>
        </div>

        <div
          style={{
            minWidth: '220px',
            border: '1px solid rgba(148, 163, 184, 0.24)',
            borderRadius: '16px',
            padding: '14px 16px',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px', fontWeight: 750 }}>
            {finance.advancesTotal}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 900, color: '#0f172a' }}>
            {formatCurrency(totalAdvances)}
          </div>
          {remainingAdvanceLimit != null ? (
            <div style={{ marginTop: '6px', color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
              Zbývá {formatCurrency(remainingAdvanceLimit)} z limitu {formatCurrency(advanceLimitAmount ?? 0)}
            </div>
          ) : null}
        </div>
      </div>

      {advancesAllowed ? (
        <form action={createAdvanceAction} className="worker-detail-advance-form">
          <input type="hidden" name="profileId" value={workerId} />
          <input type="hidden" name="month" value={selectedMonth} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 220px)',
              gap: '14px',
              alignItems: 'end',
            }}
          >
            <label>
              {finance.advanceAmount}
              <input
                name="amount"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder={finance.advanceAmountPlaceholder}
                required
              />
            </label>

            <label>
              {finance.issueDate}
              <input name="issued_at" type="date" defaultValue={todayDate} required />
            </label>
          </div>

          <label style={{ marginTop: '14px' }}>
            {finance.note}
            <textarea name="note" placeholder={finance.notePlaceholder} />
          </label>

          <button type="submit" style={{ marginTop: '14px' }}>
            {finance.saveAdvance}
          </button>
        </form>
      ) : (
        <div style={{ ...boxStyle, marginBottom: '16px', background: '#f8fafc' }}>
          <p style={{ margin: 0, color: '#64748b' }}>
            Zálohy jsou pro tohoto interního pracovníka aktuálně vypnuté podle výplatního nastavení.
          </p>
        </div>
      )}

      {workerAdvances.length === 0 ? (
        <div style={{ ...boxStyle, marginTop: '16px' }}>
          <p style={{ margin: 0, color: '#6b7280' }}>{t.noAdvances}</p>
        </div>
      ) : (
        <div style={{ ...tableWrapStyle, marginTop: '16px' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.issueDate}</th>
                <th style={thStyle}>{t.amount}</th>
                <th style={thStyle}>{dictionary.jobs.detail.note}</th>
                <th style={thStyle}>{finance.actions}</th>
              </tr>
            </thead>
            <tbody>
              {workerAdvances.map((advance, index) => {
                const canDelete = advance.id && !advance.id.startsWith('advance-request-')

                return (
                  <tr key={`${advance.id ?? 'advance'}-${index}`}>
                    <td style={tdStyle}>{formatDate(advance.issued_at)}</td>
                    <td style={tdStyle}>{formatCurrency(Number(advance.amount ?? 0))}</td>
                    <td style={tdStyle}>{advance.note?.trim() ? advance.note : '-'}</td>
                    <td style={tdStyle}>
                      {canDelete ? (
                        <form action={deleteAdvanceAction}>
                          <input type="hidden" name="profileId" value={workerId} />
                          <input type="hidden" name="month" value={selectedMonth} />
                          <input type="hidden" name="advanceId" value={advance.id} />
                          <button type="submit" className="danger-inline-button">
                            {finance.delete}
                          </button>
                        </form>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '13px' }}>Z žádosti</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
