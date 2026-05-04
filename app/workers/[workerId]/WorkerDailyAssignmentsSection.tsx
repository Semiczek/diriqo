'use client'

import Link from 'next/link'
import { useI18n } from '@/components/I18nProvider'
import {
  getEffectiveJobWorkState,
  isMultiDayJobRange,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '@/lib/job-status'
import type { WorkerDailyJobRow } from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  boxStyle,
  formatCurrency,
  formatDate,
  formatHours,
  sectionTitleStyle,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'

function getStatusMeta(item: WorkerDailyJobRow, dictionary: ReturnType<typeof useI18n>['dictionary']) {
  const effectiveWorkState = getEffectiveJobWorkState({
    timeState: resolveJobTimeState(item.jobs?.time_state ?? null),
    workState: resolveJobWorkState(item.jobs?.work_state ?? null),
    legacyStatus: resolveLegacyJobStatus(item.jobs?.status ?? null),
    isMultiDay: isMultiDayJobRange(item.jobs?.start_at ?? null, item.jobs?.end_at ?? null),
  })

  if (effectiveWorkState === 'done') {
    return {
      label: dictionary.jobs.done,
      styles: { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' },
    }
  }

  if (effectiveWorkState === 'partially_done') {
    return {
      label: dictionary.jobs.partiallyDone,
      styles: { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' },
    }
  }

  if (effectiveWorkState === 'in_progress') {
    return {
      label: dictionary.jobs.inProgress,
      styles: { backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' },
    }
  }

  return {
    label: dictionary.jobs.future,
    styles: { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  }
}

export default function WorkerDailyAssignmentsSection({
  workPeriodLabel,
  dailyJobRows,
}: {
  workPeriodLabel: string
  dailyJobRows: WorkerDailyJobRow[]
}) {
  const { dictionary } = useI18n()
  const t = dictionary.workers.detail

  return (
    <div style={{ marginBottom: '24px' }}>
      <h2 style={sectionTitleStyle}>{t.jobsHours} ({workPeriodLabel})</h2>

      {dailyJobRows.length === 0 ? (
        <div style={boxStyle}>
          <p style={{ margin: 0, color: '#6b7280' }}>{t.noJobHours}</p>
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{dictionary.customers.date}</th>
                <th style={thStyle}>{t.job}</th>
                <th style={thStyle}>{t.status}</th>
                <th style={thStyle}>{t.paid}</th>
                <th style={thStyle}>{dictionary.jobs.detail.hours}</th>
                <th style={thStyle}>{dictionary.jobs.detail.rate}</th>
                <th style={thStyle}>{t.reward}</th>
                <th style={thStyle}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {dailyJobRows.map((item) => {
                const statusMeta = getStatusMeta(item, dictionary)

                return (
                  <tr key={item.key}>
                    <td style={tdStyle}>
                      <div>{formatDate(item.work_date)}</div>
                      <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '12px' }}>
                        {item.source}
                      </div>
                      {!item.has_shift_coverage ? (
                        <div style={{ marginTop: '4px', color: '#b45309', fontSize: '12px', fontWeight: 600 }}>
                          Bez směny
                        </div>
                      ) : item.source === 'shift' ? (
                        <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '12px' }}>
                          Rozděleno podle směn
                        </div>
                      ) : null}
                    </td>
                    <td style={tdStyle}>
                      {item.jobs ? (
                        <>
                          <Link
                            href={`/jobs/${item.jobs.id}`}
                            style={{ color: '#111827', textDecoration: 'none', fontWeight: 700 }}
                          >
                            {item.jobs.title ?? dictionary.jobs.untitledJob}
                          </Link>
                          <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '13px' }}>
                            {item.jobs.address ?? '-'}
                          </div>
                        </>
                      ) : (
                        dictionary.jobs.untitledJob
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          ...statusMeta.styles,
                          display: 'inline-block',
                          padding: '6px 10px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 700,
                          lineHeight: 1.2,
                        }}
                      >
                        {statusMeta.label}
                      </span>
                    </td>
                    <td style={tdStyle}>{item.jobs?.is_paid ? dictionary.jobs.paid : dictionary.jobs.detail.unpaid}</td>
                    <td style={tdStyle}>{formatHours(item.hours)} h</td>
                    <td style={tdStyle}>{formatCurrency(item.hourly_rate)}</td>
                    <td style={tdStyle}>{formatCurrency(item.reward)}</td>
                    <td style={tdStyle}>
                      {item.jobs ? (
                        <Link
                          href={`/jobs/${item.jobs.id}`}
                          style={{
                            display: 'inline-block',
                            padding: '8px 12px',
                            borderRadius: '10px',
                            background: '#111827',
                            color: '#ffffff',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: '13px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {dictionary.dashboard.open}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
