'use client'

import React, { useMemo, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import JobAssignmentRowEditor from '@/components/JobAssignmentRowEditor'
import type { JobAssignmentRow } from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  boxStyle,
  tableStyle,
  tableWrapStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  cardTitleStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type SortMode = 'date' | 'customer'

function getAssignmentDateValue(item: JobAssignmentRow) {
  const value =
    item.jobs?.start_at ??
    item.work_started_at ??
    item.jobs?.end_at ??
    item.work_completed_at ??
    ''
  const time = value ? new Date(value).getTime() : 0
  return Number.isNaN(time) ? 0 : time
}

function getAssignmentGroupLabel(item: JobAssignmentRow) {
  const customerName = item.jobs?.customer_name?.trim()
  if (customerName) return customerName

  const title = item.jobs?.title?.trim()
  if (title) return title

  return 'Bez zakaznika'
}

export default function WorkerAssignmentsSection({
  workPeriodLabel,
  jobAssignments,
  defaultRate,
}: {
  workPeriodLabel: string
  jobAssignments: JobAssignmentRow[]
  defaultRate: number
}) {
  const { dictionary } = useI18n()
  const t = dictionary.workers.detail
  const [sortMode, setSortMode] = useState<SortMode>('date')

  const sortedAssignments = useMemo(() => {
    return [...jobAssignments].sort((left, right) => {
      if (sortMode === 'customer') {
        const groupDiff = getAssignmentGroupLabel(left).localeCompare(getAssignmentGroupLabel(right), 'cs')
        if (groupDiff !== 0) return groupDiff

        const dateDiff = getAssignmentDateValue(left) - getAssignmentDateValue(right)
        if (dateDiff !== 0) return dateDiff

        const titleDiff = (left.jobs?.title ?? '').localeCompare(right.jobs?.title ?? '', 'cs')
        if (titleDiff !== 0) return titleDiff
      }

      const dateDiff = getAssignmentDateValue(left) - getAssignmentDateValue(right)
      if (dateDiff !== 0) return dateDiff

      return (left.jobs?.title ?? '').localeCompare(right.jobs?.title ?? '', 'cs')
    })
  }, [jobAssignments, sortMode])

  const toolbarButtonStyle = (active: boolean): React.CSSProperties => ({
    ...(active ? primaryButtonStyle : secondaryButtonStyle),
    minHeight: '36px',
    padding: '8px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  })

  return (
    <section style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ ...cardTitleStyle, margin: 0 }}>Zakázky pracovníka ({workPeriodLabel})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setSortMode('date')} style={toolbarButtonStyle(sortMode === 'date')}>
            Podle data
          </button>
          <button type="button" onClick={() => setSortMode('customer')} style={toolbarButtonStyle(sortMode === 'customer')}>
            Podle zákazníka
          </button>
        </div>
      </div>

      {jobAssignments.length === 0 ? (
        <div style={boxStyle}>
          <p style={{ margin: 0, color: '#6b7280' }}>{t.noJobHours}</p>
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.job}</th>
                <th style={thStyle}>{dictionary.customers.date}</th>
                <th style={thStyle}>{t.status}</th>
                <th style={thStyle}>{t.paid}</th>
                <th style={thStyle}>{dictionary.jobs.detail.hours}</th>
                <th style={thStyle}>{dictionary.jobs.detail.rate}</th>
                <th style={thStyle}>{t.reward}</th>
                <th style={thStyle}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {sortedAssignments.map((item, index) => (
                <JobAssignmentRowEditor
                  key={`${item.job_id ?? 'job'}-${index}`}
                  item={item}
                  defaultRate={defaultRate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
