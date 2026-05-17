'use client'

import Link from 'next/link'
import React, { useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import ShiftRowEditor from '@/components/ShiftRowEditor'
import type {
  ShiftJobOption,
  WorkShiftRow,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  boxStyle,
  tableStyle,
  tableWrapStyle,
  thStyle,
} from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  cardTitleStyle,
  inputStyle as sharedInputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

export default function WorkerShiftsSection({
  workPeriodLabel,
  workShifts,
  shiftJobs,
  shiftJobsMap,
  workShiftsSupportJobAssignment,
  workerId,
  companyId,
  selectedMonth,
  exportHref,
  createShiftAction,
}: {
  workPeriodLabel: string
  workShifts: WorkShiftRow[]
  shiftJobs: ShiftJobOption[]
  shiftJobsMap: Map<string, string>
  workShiftsSupportJobAssignment: boolean
  workerId: string
  companyId: string | null
  selectedMonth: string
  exportHref: string
  createShiftAction: (formData: FormData) => Promise<void>
}) {
  const { dictionary } = useI18n()
  const t = dictionary.workers.detail
  const [isCreating, setIsCreating] = useState(false)

  const inputStyle: React.CSSProperties = {
    ...sharedInputStyle,
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#374151',
    fontSize: '13px',
    fontWeight: 700,
    marginBottom: 6,
  }
  const buttonStyle: React.CSSProperties = {
    ...secondaryButtonStyle,
    minHeight: '38px',
    padding: '9px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  }

  return (
    <section style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ ...cardTitleStyle, margin: 0 }}>{t.shifts} ({workPeriodLabel})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={exportHref} download style={{ ...buttonStyle, textDecoration: 'none' }}>
            Export do Excelu
          </Link>
          <button
            type="button"
            onClick={() => setIsCreating((value) => !value)}
            style={{ ...(isCreating ? buttonStyle : primaryButtonStyle), cursor: 'pointer' }}
          >
            {isCreating ? dictionary.common.cancel : 'Vytvořit směnu'}
          </button>
        </div>
      </div>

      {isCreating ? (
        <form action={createShiftAction} style={{ ...boxStyle, marginBottom: '16px' }}>
          <input type="hidden" name="profileId" value={workerId} />
          <input type="hidden" name="companyId" value={companyId ?? ''} />
          <input type="hidden" name="month" value={selectedMonth} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label>
              <span style={labelStyle}>{t.shiftDate}</span>
              <input name="shift_date" type="date" required style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>{dictionary.jobs.startLabel}</span>
              <input name="started_at" type="datetime-local" style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>{dictionary.jobs.endLabel}</span>
              <input name="ended_at" type="datetime-local" style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>{t.hoursOverride}</span>
              <input name="hours_override" type="number" step="0.01" min="0" placeholder="7.5" style={inputStyle} />
            </label>
            {workShiftsSupportJobAssignment ? (
              <>
                <label>
                  <span style={labelStyle}>{t.job}</span>
                  <select name="job_id" style={inputStyle}>
                    <option value="">{t.unassigned}</option>
                    {shiftJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title ?? t.unnamedJob}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={labelStyle}>Hodiny na zakázku</span>
                  <input name="job_hours_override" type="number" step="0.01" min="0" placeholder="auto" style={inputStyle} />
                </label>
              </>
            ) : null}
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={labelStyle}>{dictionary.jobs.detail.note}</span>
            <textarea name="note" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="submit" style={{ ...primaryButtonStyle, cursor: 'pointer' }}>
              {dictionary.common.save}
            </button>
            <button type="button" onClick={() => setIsCreating(false)} style={buttonStyle}>
              {dictionary.common.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {workShifts.length === 0 ? (
        <div style={boxStyle}>
          <p style={{ margin: 0, color: '#6b7280' }}>{t.noShifts}</p>
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.shiftDate}</th>
                <th style={thStyle}>{t.job}</th>
                <th style={thStyle}>{dictionary.jobs.startLabel}</th>
                <th style={thStyle}>{dictionary.jobs.endLabel}</th>
                <th style={thStyle}>{t.hoursOverride}</th>
                <th style={thStyle}>{t.effectiveHours}</th>
                <th style={thStyle}>{dictionary.jobs.detail.note}</th>
                <th style={thStyle}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {workShifts.map((shift) => (
                <ShiftRowEditor
                  key={shift.id}
                  shift={{
                    id: shift.id,
                    job_id: shift.job_id ?? null,
                    job_title: shift.job_id != null ? shiftJobsMap.get(shift.job_id) ?? t.unassigned : null,
                    job_hours_override: shift.job_hours_override ?? null,
                    shift_date: shift.shift_date ?? null,
                    started_at: shift.started_at ?? null,
                    ended_at: shift.ended_at ?? null,
                    hours_override: shift.hours_override ?? null,
                    note: shift.note ?? null,
                  }}
                  jobs={shiftJobs}
                  supportsJobAssignment={workShiftsSupportJobAssignment}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
