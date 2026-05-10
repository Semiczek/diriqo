'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { updateJobAssignmentEconomicsAction } from '@/app/business-actions'
import { useI18n } from '@/components/I18nProvider'
import { getIntlLocale } from '@/lib/i18n/config'
import {
  getEffectiveJobWorkState,
  isMultiDayJobRange,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '@/lib/job-status'

type Props = {
  item: {
    id?: string
    job_id: string | null
    profile_id: string | null
    labor_hours: number | null
    hourly_rate: number | null
    work_started_at?: string | null
    work_completed_at?: string | null
    effective_hours?: number | null
    effective_rate?: number | null
    effective_reward?: number | null
    jobs: {
      id: string
      customer_name?: string | null
      title: string | null
      address: string | null
      status: string | null
      start_at?: string | null
      end_at?: string | null
      time_state?: string | null
      work_state?: string | null
      is_paid: boolean | null
    } | null
  }
  defaultRate: number
}

function formatHours(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function resolveDisplayStatus(
  status: string | null,
  timeState: string | null | undefined,
  workState: string | null | undefined,
  startAt: string | null | undefined,
  endAt: string | null | undefined
) {
  const effectiveWorkState = getEffectiveJobWorkState({
    timeState: resolveJobTimeState(timeState),
    workState: resolveJobWorkState(workState),
    legacyStatus: resolveLegacyJobStatus(status),
    isMultiDay: isMultiDayJobRange(startAt ?? null, endAt ?? null),
  })

  if (effectiveWorkState === 'done') return 'done'
  if (effectiveWorkState === 'partially_done') return 'waiting_check'
  if (effectiveWorkState === 'in_progress') return 'in_progress'
  if (effectiveWorkState === 'not_started') return 'planned'

  const now = Date.now()
  const startTime = startAt ? new Date(startAt).getTime() : Number.NaN
  const endTime = endAt ? new Date(endAt).getTime() : Number.NaN

  if (!Number.isNaN(startTime) && startTime > now) return 'planned'
  if (!Number.isNaN(startTime) && !Number.isNaN(endTime) && startTime <= now && endTime >= now) {
    return 'in_progress'
  }
  if (!Number.isNaN(endTime) && endTime < now) return 'done'

  if (
    status === 'planned' ||
    status === 'in_progress' ||
    status === 'waiting_check' ||
    status === 'done'
  ) {
    return status
  }

  return status
}

function getFallbackHours(startedAt: string | null | undefined, completedAt: string | null | undefined) {
  if (!startedAt || !completedAt) return 0

  const start = new Date(startedAt)
  const end = new Date(completedAt)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0

  return Math.round((diffMs / 1000 / 60 / 60) * 100) / 100
}

function getEffectiveHours(item: Props['item']) {
  if (item.effective_hours != null && Number(item.effective_hours) > 0) {
    return Number(item.effective_hours)
  }

  if (item.labor_hours != null && Number(item.labor_hours) > 0) {
    return Number(item.labor_hours)
  }

  return getFallbackHours(item.work_started_at, item.work_completed_at)
}

function getEffectiveRate(item: Props['item'], defaultRate: number) {
  if (item.effective_rate != null && Number(item.effective_rate) > 0) {
    return Number(item.effective_rate)
  }

  if (item.hourly_rate != null && Number(item.hourly_rate) > 0) {
    return Number(item.hourly_rate)
  }

  return Number(defaultRate ?? 0)
}

export default function JobAssignmentRowEditor({ item, defaultRate }: Props) {
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)
  const t = dictionary.jobs.detail
  const [editing, setEditing] = useState(false)
  const fallbackHours = useMemo(() => getEffectiveHours(item), [item])
  const [laborHoursInput, setLaborHoursInput] = useState(item.labor_hours != null ? String(item.labor_hours) : '')
  const [hourlyRateInput, setHourlyRateInput] = useState(item.hourly_rate != null ? String(item.hourly_rate) : String(defaultRate || ''))
  const [currentLaborHours, setCurrentLaborHours] = useState(getEffectiveHours(item))
  const [currentHourlyRate, setCurrentHourlyRate] = useState(getEffectiveRate(item, defaultRate))
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getPaymentLabel = (isPaid: boolean | null) => (isPaid === true ? dictionary.jobs.paid : t.unpaid)

  const getStatusLabel = (
    status: string | null,
    timeState: string | null | undefined,
    workState: string | null | undefined,
    startAt: string | null | undefined,
    endAt: string | null | undefined
  ) => {
    const resolvedStatus = resolveDisplayStatus(status, timeState, workState, startAt, endAt)

    if (resolvedStatus === 'planned') return dictionary.jobs.future
    if (resolvedStatus === 'in_progress') return dictionary.jobs.inProgress
    if (resolvedStatus === 'waiting_check') return dictionary.jobs.partiallyDone
    if (resolvedStatus === 'done') return dictionary.jobs.done
    return status ?? '-'
  }

  const getStatusStyles = (
    status: string | null,
    timeState: string | null | undefined,
    workState: string | null | undefined,
    startAt: string | null | undefined,
    endAt: string | null | undefined
  ): React.CSSProperties => {
    const resolvedStatus = resolveDisplayStatus(status, timeState, workState, startAt, endAt)

    if (resolvedStatus === 'planned') {
      return { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' }
    }
    if (resolvedStatus === 'in_progress') {
      return { backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }
    }
    if (resolvedStatus === 'waiting_check') {
      return { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }
    }
    if (resolvedStatus === 'done') {
      return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
    }
    return { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }
  }

  const effectivePreviewRate = useMemo(() => {
    const normalized = hourlyRateInput.replace(',', '.').trim()
    if (!normalized) return Number(defaultRate ?? 0)
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return Number(defaultRate ?? 0)
    return parsed
  }, [hourlyRateInput, defaultRate])

  const effectivePreviewHours = useMemo(() => {
    const normalized = laborHoursInput.replace(',', '.').trim()
    if (!normalized) return fallbackHours
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return fallbackHours
    return parsed
  }, [laborHoursInput, fallbackHours])

  const previewReward = effectivePreviewHours * effectivePreviewRate

  function resetForm() {
    setLaborHoursInput(item.labor_hours != null ? String(item.labor_hours) : '')
    setHourlyRateInput(item.hourly_rate != null ? String(item.hourly_rate) : String(defaultRate || ''))
    setError(null)
  }

  async function handleSave() {
    setError(null)

    if (!item.job_id || !item.profile_id) {
      setError(t.missingAssignmentIds)
      return
    }

    const parsedHours = Number(laborHoursInput.replace(',', '.').trim())
    if (!Number.isFinite(parsedHours) || parsedHours < 0) {
      setError(t.hoursValidation)
      return
    }

    const parsedRate = Number(hourlyRateInput.replace(',', '.').trim())
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      setError(t.rateValidation)
      return
    }

    setSaving(true)

    const result = await updateJobAssignmentEconomicsAction({
      jobId: item.job_id,
      profileId: item.profile_id,
      laborHours: Math.round(parsedHours * 100) / 100,
      hourlyRate: Math.round(parsedRate * 100) / 100,
    })

    setSaving(false)

    if (!result.ok) {
      setError(result.error || t.saveFailed)
      return
    }

    setCurrentLaborHours(Math.round(parsedHours * 100) / 100)
    setCurrentHourlyRate(Math.round(parsedRate * 100) / 100)
    setEditing(false)
  }

  async function handleResetHours() {
    const confirmed = window.confirm(
      t.resetAssignmentHoursConfirm
    )

    if (!confirmed) return

    if (!item.id && (!item.job_id || !item.profile_id)) {
      setError(t.missingAssignmentIds)
      return
    }

    setResetting(true)
    setError(null)

    const resetResponse = item.id
      ? await fetch(`/api/job-assignments/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reset_hours',
            reason: 'Admin reset from worker detail',
          }),
        })
      : null

    setResetting(false)

    if (!resetResponse?.ok) {
      const body = (await resetResponse?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error || t.saveFailed)
      return
    }

    setLaborHoursInput('')
    setCurrentLaborHours(0)
    setEditing(false)
  }

  async function handleRemoveAssignment() {
    const confirmed = window.confirm(
      t.removeWorkerConfirm
    )

    if (!confirmed) return

    if (!item.id && (!item.job_id || !item.profile_id)) {
      setError(t.missingAssignmentIds)
      return
    }

    setRemoving(true)
    setError(null)

    const removeResponse = item.id
      ? await fetch(`/api/job-assignments/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'archive',
            reason: 'Admin removed assignment from worker detail',
          }),
        })
      : null

    setRemoving(false)

    if (!removeResponse?.ok) {
      const body = (await removeResponse?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error || t.saveFailed)
      return
    }

    setRemoved(true)
  }

  const tdStyle: React.CSSProperties = {
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '14px',
    color: '#111827',
    verticalAlign: 'top',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '110px',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#111827',
    background: '#ffffff',
    boxSizing: 'border-box',
  }

  const primaryButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '8px 12px',
    borderRadius: '10px',
    background: '#111827',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: '13px',
    whiteSpace: 'nowrap',
    border: 'none',
    cursor: 'pointer',
  }

  const successButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '8px 12px',
    borderRadius: '10px',
    background: '#16a34a',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: '13px',
    whiteSpace: 'nowrap',
    border: 'none',
    cursor: 'pointer',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '8px 12px',
    borderRadius: '10px',
    background: '#e5e7eb',
    color: '#111827',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: '13px',
    whiteSpace: 'nowrap',
    border: 'none',
    cursor: 'pointer',
  }

  const dangerButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '8px 12px',
    borderRadius: '10px',
    background: '#fee2e2',
    color: '#991b1b',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: '13px',
    whiteSpace: 'nowrap',
    border: 'none',
    cursor: 'pointer',
  }

  if (removed) {
    return null
  }

  if (!editing) {
    const reward = currentLaborHours * currentHourlyRate

    return (
      <tr>
        <td style={tdStyle}>
          {item.jobs ? (
            <>
              <Link href={`/jobs/${item.jobs.id}`} style={{ color: '#111827', textDecoration: 'none', fontWeight: 700 }}>
                {item.jobs.title ?? dictionary.jobs.untitledJob}
              </Link>
              {item.jobs.customer_name ? (
                <div style={{ marginTop: '4px', color: '#374151', fontSize: '13px', fontWeight: 600 }}>{item.jobs.customer_name}</div>
              ) : null}
              <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '13px' }}>{item.jobs.address ?? '-'}</div>
            </>
          ) : '-'}
        </td>
        <td style={tdStyle}>
          <div style={{ minWidth: 132 }}>
            <div>{formatDate(item.jobs?.start_at ?? null, dateLocale)}</div>
            <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '13px' }}>
              {dictionary.jobs.endLabel}: {formatDate(item.jobs?.end_at ?? null, dateLocale)}
            </div>
          </div>
        </td>

        <td style={tdStyle}>
          <span style={{ ...getStatusStyles(item.jobs?.status ?? null, item.jobs?.time_state ?? null, item.jobs?.work_state ?? null, item.jobs?.start_at ?? null, item.jobs?.end_at ?? null), display: 'inline-block', padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, lineHeight: 1.2 }}>
            {getStatusLabel(item.jobs?.status ?? null, item.jobs?.time_state ?? null, item.jobs?.work_state ?? null, item.jobs?.start_at ?? null, item.jobs?.end_at ?? null)}
          </span>
        </td>
        <td style={tdStyle}>{getPaymentLabel(item.jobs?.is_paid ?? null)}</td>
        <td style={tdStyle}>{formatHours(currentLaborHours, dateLocale)} h</td>
        <td style={tdStyle}>{currentHourlyRate > 0 ? formatCurrency(currentHourlyRate, dateLocale) : '-'}</td>
        <td style={tdStyle}>{formatCurrency(reward, dateLocale)}</td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { resetForm(); setEditing(true) }} style={primaryButtonStyle}>
              {t.edit}
            </button>
            <button
              type="button"
              onClick={handleResetHours}
              disabled={resetting || removing}
              style={{ ...secondaryButtonStyle, opacity: resetting || removing ? 0.7 : 1 }}
            >
              {resetting ? t.resettingAssignmentHours : t.resetAssignmentHours}
            </button>
            <button
              type="button"
              onClick={handleRemoveAssignment}
              disabled={resetting || removing}
              style={{ ...dangerButtonStyle, opacity: resetting || removing ? 0.7 : 1 }}
            >
              {removing ? t.removingWorker : t.removeWorker}
            </button>
          </div>
          {error ? (
            <div style={{ marginTop: '8px', color: '#b91c1c', fontSize: '13px' }}>{error}</div>
          ) : null}
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr style={{ background: '#fff8e1', boxShadow: 'inset 0 0 0 2px #f59e0b' }}>
        <td style={tdStyle}>
          <div style={{ fontWeight: 700, color: '#111827' }}>{item.jobs?.title ?? dictionary.jobs.untitledJob}</div>
          {item.jobs?.customer_name ? (
            <div style={{ marginTop: '4px', color: '#374151', fontSize: '13px', fontWeight: 600 }}>{item.jobs.customer_name}</div>
          ) : null}
          <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '13px' }}>{item.jobs?.address ?? '-'}</div>
        </td>
        <td style={tdStyle}>
          <div style={{ minWidth: 132 }}>
            <div>{formatDate(item.jobs?.start_at ?? null, dateLocale)}</div>
            <div style={{ marginTop: '4px', color: '#6b7280', fontSize: '13px' }}>
              {dictionary.jobs.endLabel}: {formatDate(item.jobs?.end_at ?? null, dateLocale)}
            </div>
          </div>
        </td>
        <td style={tdStyle}>
          <span style={{ ...getStatusStyles(item.jobs?.status ?? null, item.jobs?.time_state ?? null, item.jobs?.work_state ?? null, item.jobs?.start_at ?? null, item.jobs?.end_at ?? null), display: 'inline-block', padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, lineHeight: 1.2 }}>
            {getStatusLabel(item.jobs?.status ?? null, item.jobs?.time_state ?? null, item.jobs?.work_state ?? null, item.jobs?.start_at ?? null, item.jobs?.end_at ?? null)}
          </span>
        </td>
        <td style={tdStyle}>{getPaymentLabel(item.jobs?.is_paid ?? null)}</td>
        <td style={tdStyle}><input type="number" step="0.01" min="0" value={laborHoursInput} onChange={(e) => setLaborHoursInput(e.target.value)} style={inputStyle} /></td>
        <td style={tdStyle}><input type="number" step="0.01" min="0" value={hourlyRateInput} onChange={(e) => setHourlyRateInput(e.target.value)} style={inputStyle} /></td>
        <td style={tdStyle}>{formatCurrency(previewReward, dateLocale)}</td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={{ ...successButtonStyle, background: saving ? '#9ca3af' : '#16a34a', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? dictionary.jobs.saving : dictionary.common.save}
            </button>
            <button type="button" onClick={() => { resetForm(); setEditing(false) }} disabled={saving} style={{ ...secondaryButtonStyle, opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer' }}>
              {dictionary.common.cancel}
            </button>
          </div>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} style={{ padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fef2f2', color: '#b91c1c', fontSize: '13px' }}>
            {error}
          </td>
        </tr>
      ) : null}
    </>
  )
}
