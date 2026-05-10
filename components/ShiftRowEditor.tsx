'use client'

import React, { useMemo, useState } from 'react'
import { updateWorkShiftAction } from '@/app/business-actions'
import { useI18n } from '@/components/I18nProvider'
import { getIntlLocale } from '@/lib/i18n/config'

type ShiftRowEditorProps = {
  shift: {
    id: string
    job_id: string | null
    job_title: string | null
    job_hours_override: number | null
    shift_date: string | null
    started_at: string | null
    ended_at: string | null
    hours_override: number | null
    note: string | null
  }
  jobs: {
    id: string
    title: string | null
    start_at?: string | null
    end_at?: string | null
  }[]
  supportsJobAssignment: boolean
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatDateTime(value: string | null | undefined, locale: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatJobOptionLabel(job: {
  title: string | null
  start_at?: string | null
  end_at?: string | null
}, locale: string, untitledJobLabel: string) {
  const title = job.title ?? untitledJobLabel

  if (!job.start_at) return title

  const start = new Date(job.start_at)
  if (Number.isNaN(start.getTime())) return title

  const startLabel = new Intl.DateTimeFormat(locale).format(start)

  if (!job.end_at) return `${title} (${startLabel})`

  const end = new Date(job.end_at)
  if (Number.isNaN(end.getTime())) return `${title} (${startLabel})`

  const endLabel = new Intl.DateTimeFormat(locale).format(end)

  if (startLabel === endLabel) return `${title} (${startLabel})`

  return `${title} (${startLabel} - ${endLabel})`
}

function computeHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null
  const start = new Date(startedAt)
  const end = new Date(endedAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return null
  const hours = diffMs / 1000 / 60 / 60
  return Math.round(hours * 100) / 100
}

export default function ShiftRowEditor({ shift, jobs, supportsJobAssignment }: ShiftRowEditorProps) {
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)
  const t = dictionary.jobs.detail
  const workerT = dictionary.workers.detail
  const [currentShift, setCurrentShift] = useState(shift)
  const [isEditing, setIsEditing] = useState(false)
  const [jobIdInput, setJobIdInput] = useState(shift.job_id ?? '')
  const [jobHoursOverrideInput, setJobHoursOverrideInput] = useState(shift.job_hours_override != null ? String(shift.job_hours_override) : '')
  const [startedAtInput, setStartedAtInput] = useState(toDateTimeLocalValue(shift.started_at))
  const [endedAtInput, setEndedAtInput] = useState(toDateTimeLocalValue(shift.ended_at))
  const [hoursOverrideInput, setHoursOverrideInput] = useState(shift.hours_override != null ? String(shift.hours_override) : '')
  const [noteInput, setNoteInput] = useState(shift.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startedAtIso = useMemo(() => toIsoOrNull(startedAtInput), [startedAtInput])
  const endedAtIso = useMemo(() => toIsoOrNull(endedAtInput), [endedAtInput])
  const calculatedHours = useMemo(() => computeHours(startedAtIso, endedAtIso), [startedAtIso, endedAtIso])

  const effectiveHours = currentShift.hours_override != null ? currentShift.hours_override : computeHours(currentShift.started_at, currentShift.ended_at)
  const allocatedJobHours = currentShift.job_id != null && currentShift.job_hours_override != null ? currentShift.job_hours_override : null

  function resetFormFromCurrent() {
    setJobIdInput(currentShift.job_id ?? '')
    setJobHoursOverrideInput(currentShift.job_hours_override != null ? String(currentShift.job_hours_override) : '')
    setStartedAtInput(toDateTimeLocalValue(currentShift.started_at))
    setEndedAtInput(toDateTimeLocalValue(currentShift.ended_at))
    setHoursOverrideInput(currentShift.hours_override != null ? String(currentShift.hours_override) : '')
    setNoteInput(currentShift.note ?? '')
    setError(null)
  }

  async function handleSave() {
    setError(null)

    const startedAt = toIsoOrNull(startedAtInput)
    const endedAt = toIsoOrNull(endedAtInput)

    if (startedAt && endedAt) {
      const start = new Date(startedAt)
      const end = new Date(endedAt)
      if (end.getTime() <= start.getTime()) {
        setError(t.shiftEndValidation)
        return
      }
    }

    let parsedHoursOverride: number | null = null
    let parsedJobHoursOverride: number | null = null

    if (hoursOverrideInput.trim() !== '') {
      const parsed = Number(hoursOverrideInput.replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError(t.shiftHoursOverrideValidation)
        return
      }
      parsedHoursOverride = Math.round(parsed * 100) / 100
    }

    if (jobHoursOverrideInput.trim() !== '') {
      const parsed = Number(jobHoursOverrideInput.replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError(t.shiftJobHoursValidation)
        return
      }
      parsedJobHoursOverride = Math.round(parsed * 100) / 100
    }

    if (jobIdInput.trim() !== '' && parsedJobHoursOverride == null) {
      setError(t.shiftRequiresJobHours)
      return
    }

    const effectiveShiftHours = parsedHoursOverride != null ? parsedHoursOverride : computeHours(startedAt, endedAt)
    if (parsedJobHoursOverride != null && effectiveShiftHours != null && parsedJobHoursOverride > effectiveShiftHours) {
      setError(t.shiftJobHoursTooHigh)
      return
    }

    setSaving(true)

    const result = await updateWorkShiftAction({
      shiftId: currentShift.id,
      jobId: supportsJobAssignment ? jobIdInput.trim() || null : null,
      shiftDate: currentShift.shift_date,
      startedAt,
      endedAt,
      hoursOverride: parsedHoursOverride,
      jobHoursOverride: supportsJobAssignment && jobIdInput.trim() !== '' ? parsedJobHoursOverride : null,
      note: noteInput.trim() || null,
      supportsJobAssignment,
    })

    setSaving(false)

    if (!result.ok) {
      setError(result.error || t.saveFailed)
      return
    }

    if (!result.data.shift) {
      setError(t.updatedDataMissing)
      return
    }

    const data = result.data.shift
    const updatedJobId = supportsJobAssignment && 'job_id' in data && (typeof data.job_id === 'string' || data.job_id === null) ? data.job_id : null
    const updatedJobHoursOverride = supportsJobAssignment && 'job_hours_override' in data && (typeof data.job_hours_override === 'number' || typeof data.job_hours_override === 'string' || data.job_hours_override === null)
      ? data.job_hours_override != null ? Number(data.job_hours_override) : null
      : null

    setCurrentShift({ ...data, job_id: updatedJobId, job_hours_override: updatedJobHoursOverride, job_title: updatedJobId ? jobs.find((job) => job.id === updatedJobId)?.title ?? null : null })
    setIsEditing(false)
  }

  const rowStyle: React.CSSProperties = isEditing ? { background: '#fff8e1', boxShadow: 'inset 0 0 0 2px #f59e0b' } : {}
  const cellStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top', fontSize: 14 }
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }
  const buttonStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }

  if (!isEditing) {
    return (
      <tr style={rowStyle}>
        <td style={cellStyle}>{formatDate(currentShift.shift_date, dateLocale)}</td>
        <td style={cellStyle}>
          {supportsJobAssignment ? (
            <div style={{ minWidth: 140 }}>
              <div>{currentShift.job_title ?? workerT.unassigned}</div>
              {allocatedJobHours != null ? (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{dictionary.jobs.detail.hours}: {allocatedJobHours} h</div>
              ) : currentShift.job_id != null ? (
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>{workerT.missingJobHours}</div>
              ) : null}
            </div>
          ) : workerT.unsupported}
        </td>
        <td style={cellStyle}>{formatDateTime(currentShift.started_at, dateLocale)}</td>
        <td style={cellStyle}>{formatDateTime(currentShift.ended_at, dateLocale)}</td>
        <td style={cellStyle}>{currentShift.hours_override != null ? currentShift.hours_override : '-'}</td>
        <td style={cellStyle}>{effectiveHours != null ? effectiveHours : '-'}</td>
        <td style={cellStyle}>{currentShift.note || '-'}</td>
        <td style={cellStyle}>
          <button type="button" onClick={() => { resetFormFromCurrent(); setIsEditing(true) }} style={{ ...buttonStyle, background: '#111827', color: '#ffffff' }}>
            {t.edit}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr style={rowStyle}>
        <td style={cellStyle}>{formatDate(currentShift.shift_date, dateLocale)}</td>
        <td style={cellStyle}>
          {supportsJobAssignment ? (
            <>
              <select value={jobIdInput} onChange={(e) => setJobIdInput(e.target.value)} style={inputStyle}>
                <option value="">{workerT.unassigned}</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{formatJobOptionLabel(job, dateLocale, dictionary.jobs.untitledJob)}</option>
                ))}
              </select>
              <input type="number" step="0.01" min="0" value={jobHoursOverrideInput} onChange={(e) => setJobHoursOverrideInput(e.target.value)} placeholder={dictionary.jobs.detail.hours} style={{ ...inputStyle, marginTop: 8 }} />
            </>
          ) : (
            <div style={{ color: '#6b7280', minWidth: 120 }}>{workerT.unsupported}</div>
          )}
        </td>
        <td style={cellStyle}><input type="datetime-local" value={startedAtInput} onChange={(e) => setStartedAtInput(e.target.value)} style={inputStyle} /></td>
        <td style={cellStyle}><input type="datetime-local" value={endedAtInput} onChange={(e) => setEndedAtInput(e.target.value)} style={inputStyle} /></td>
        <td style={cellStyle}><input type="number" step="0.01" min="0" value={hoursOverrideInput} onChange={(e) => setHoursOverrideInput(e.target.value)} placeholder="7.5" style={inputStyle} /></td>
        <td style={cellStyle}><div style={{ minWidth: 80 }}>{hoursOverrideInput.trim() !== '' ? hoursOverrideInput.replace(',', '.') : calculatedHours != null ? calculatedHours : '-'}</div></td>
        <td style={cellStyle}><textarea value={noteInput} onChange={(e) => setNoteInput(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }} /></td>
        <td style={cellStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={{ ...buttonStyle, background: saving ? '#9ca3af' : '#16a34a', color: '#ffffff', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? dictionary.jobs.saving : dictionary.common.save}
            </button>
            <button type="button" onClick={() => { resetFormFromCurrent(); setIsEditing(false) }} disabled={saving} style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827', cursor: saving ? 'default' : 'pointer' }}>
              {dictionary.common.cancel}
            </button>
          </div>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </td>
        </tr>
      ) : null}
    </>
  )
}
