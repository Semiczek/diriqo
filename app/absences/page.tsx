'use client'

import React, { useEffect, useMemo, useState } from 'react'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'
import { updateAbsenceStatusAction } from './actions'

type AbsenceRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  absence_mode: string | null
  absence_type: string | null
  start_at: string | null
  end_at: string | null
  note: string | null
  status: string | null
  created_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
}

type AbsenceView = {
  id: string
  companyId: string | null
  profileId: string | null
  employeeName: string
  employeeEmail: string
  absenceMode: 'planned' | 'sick'
  absenceType: 'planned' | 'sick'
  startAt: string | null
  endAt: string | null
  note: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string | null
  reviewedAt: string | null
}

function normalizeAbsenceMode(value: string | null | undefined): 'planned' | 'sick' {
  return value === 'sick' ? 'sick' : 'planned'
}

function normalizeAbsenceType(value: string | null | undefined): 'planned' | 'sick' {
  return value === 'sick' ? 'sick' : 'planned'
}

function normalizeAbsenceStatus(
  value: string | null | undefined
): 'pending' | 'approved' | 'rejected' {
  if (value === 'approved') return 'approved'
  if (value === 'rejected') return 'rejected'
  return 'pending'
}

function getMonthKeyFromDateString(value: string | null) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function getCurrentMonthKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString(locale)
}

function formatMonthLabel(monthKey: string, locale: string) {
  const date = new Date(`${monthKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey

  const formatted = date.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function getAbsenceModeLabel(mode: 'planned' | 'sick', planned: string, urgent: string) {
  return mode === 'planned' ? planned : urgent
}

function getAbsenceTypeLabel(type: 'planned' | 'sick', planned: string, sick: string) {
  return type === 'planned' ? planned : sick
}

function getStatusLabel(
  status: 'pending' | 'approved' | 'rejected',
  pending: string,
  approved: string,
  rejected: string
) {
  switch (status) {
    case 'approved':
      return approved
    case 'rejected':
      return rejected
    default:
      return pending
  }
}

function getStatusBadgeStyle(status: 'pending' | 'approved' | 'rejected'): React.CSSProperties {
  switch (status) {
    case 'approved':
      return {
        background: '#dcfce7',
        color: '#166534',
      }
    case 'rejected':
      return {
        background: '#fee2e2',
        color: '#b91c1c',
      }
    default:
      return {
        background: '#fef3c7',
        color: '#92400e',
      }
  }
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '24px',
  padding: '20px',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: '12px',
  border: '1px solid #d1d5db',
  fontSize: '16px',
  backgroundColor: '#ffffff',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  fontWeight: 700,
  fontSize: '14px',
}

const buttonBaseStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '12px',
  padding: '10px 14px',
  fontWeight: 700,
  fontSize: '14px',
  cursor: 'pointer',
}

export default function AbsencesPage() {
  const { dictionary, locale } = useI18n()
  const t = dictionary.absences
  const localeTag = locale === 'cs' ? 'cs-CZ' : locale === 'de' ? 'de-DE' : 'en-US'
  const currentMonthKey = getCurrentMonthKey()
  const initialYear = new Date(`${currentMonthKey}T00:00:00`).getFullYear()

  const [items, setItems] = useState<AbsenceView[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState(initialYear)
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all'
  )

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      const { data: absencesData, error: absencesError } = await supabase
        .from('absence_requests')
        .select(`
          id,
          company_id,
          profile_id,
          absence_mode,
          absence_type,
          start_at,
          end_at,
          note,
          status,
          created_at,
          reviewed_at,
          reviewed_by
        `)
        .order('created_at', { ascending: false })

      if (absencesError) {
        console.error('Absences load failed', absencesError)
        setError(dictionary.common.dataLoadFailed)
        setLoading(false)
        return
      }

      const absenceRows = (((absencesData ?? []) as unknown) as AbsenceRow[])

      const uniqueProfileIds = Array.from(
        new Set(
          absenceRows
            .map((item) => item.profile_id)
            .filter((value): value is string => Boolean(value))
        )
      )

      let profileMap = new Map<string, ProfileRow>()

      if (uniqueProfileIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', uniqueProfileIds)

        if (profilesError) {
          console.error('Absence profiles load failed', profilesError)
          setError(dictionary.common.dataLoadFailed)
          setLoading(false)
          return
        }

        profileMap = new Map(
          ((((profilesData ?? []) as unknown) as ProfileRow[])).map((profile) => [
            profile.id,
            profile,
          ])
        )
      }

      const normalized: AbsenceView[] = absenceRows.map((row) => {
        const profile = row.profile_id ? profileMap.get(row.profile_id) : null

        return {
          id: row.id,
          companyId: row.company_id,
          profileId: row.profile_id,
          employeeName: profile?.full_name || t.unknownWorker,
          employeeEmail: profile?.email || '',
          absenceMode: normalizeAbsenceMode(row.absence_mode),
          absenceType: normalizeAbsenceType(row.absence_type),
          startAt: row.start_at,
          endAt: row.end_at,
          note: row.note || '',
          status: normalizeAbsenceStatus(row.status),
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at,
        }
      })

      setItems(normalized)
      setLoading(false)
    }

    loadData()
  }, [dictionary.common.dataLoadFailed, t.unknownWorker])

  const yearOptions = useMemo(() => {
    const years = new Set<number>()
    years.add(selectedYear)
    years.add(selectedYear - 1)
    years.add(selectedYear + 1)

    for (const item of items) {
      const monthKey = getMonthKeyFromDateString(item.startAt)
      if (!monthKey) continue

      const date = new Date(`${monthKey}T00:00:00`)
      if (!Number.isNaN(date.getTime())) {
        years.add(date.getFullYear())
      }
    }

    return Array.from(years).sort((a, b) => b - a)
  }, [items, selectedYear])

  const monthOptions = useMemo(() => {
    const result: string[] = []

    for (let month = 0; month < 12; month += 1) {
      const monthValue = String(month + 1).padStart(2, '0')
      result.push(`${selectedYear}-${monthValue}-01`)
    }

    return result
  }, [selectedYear])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const monthKey = getMonthKeyFromDateString(item.startAt)
      const matchesMonth = monthKey === selectedMonth
      const matchesStatus = statusFilter === 'all' ? true : item.status === statusFilter

      return matchesMonth && matchesStatus
    })
  }, [items, selectedMonth, statusFilter])

  const pendingCount = filteredItems.filter((item) => item.status === 'pending').length
  const approvedCount = filteredItems.filter((item) => item.status === 'approved').length
  const rejectedCount = filteredItems.filter((item) => item.status === 'rejected').length

  async function updateStatus(itemId: string, nextStatus: 'approved' | 'rejected') {
    setSavingId(itemId)
    setError(null)

    const result = await updateAbsenceStatusAction({
      absenceId: itemId,
      status: nextStatus,
    })

    if (!result.ok) {
      console.error('Absence status update failed', result.error)
      setError(dictionary.common.dataSaveFailed)
      setSavingId(null)
      return
    }

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: nextStatus,
              reviewedAt: result.data.reviewedAt,
            }
          : item
      )
    )

    setSavingId(null)
  }

  return (
    <DashboardShell activeItem="absences">
      <main
        style={{
          display: 'grid',
          gap: '12px',
          maxWidth: '1120px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <section
          data-tour="absences-header"
          style={{
            ...cardStyle,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '20px',
            background:
              'radial-gradient(circle at 8% 8%, rgba(124, 58, 237, 0.14), transparent 30%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.14), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(239,246,255,0.9) 55%, rgba(240,253,250,0.88))',
            padding: '18px 20px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              borderRadius: '999px',
              padding: '4px 9px',
              marginBottom: '8px',
              background: 'rgba(124, 58, 237, 0.1)',
              border: '1px solid rgba(124, 58, 237, 0.2)',
              color: '#5b21b6',
              fontSize: '11px',
              fontWeight: 850,
            }}
          >
            {dictionary.navigation.teamGroup}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: '32px',
              lineHeight: 1.08,
              color: '#020617',
            }}
          >
            {t.title}
          </h1>

          <p
            style={{
              margin: '7px 0 0',
              color: '#475569',
              fontSize: '14px',
              lineHeight: 1.45,
              maxWidth: '620px',
            }}
          >
            {t.subtitle}
          </p>
        </section>

        <section
          data-tour="absences-summary"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '16px',
          }}
        >
          <div style={cardStyle}>
            <div style={{ color: '#6b7280', marginBottom: '8px' }}>{t.pending}</div>
            <div style={{ fontSize: '40px', fontWeight: 800 }}>{pendingCount}</div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: '#6b7280', marginBottom: '8px' }}>{t.approved}</div>
            <div style={{ fontSize: '40px', fontWeight: 800 }}>{approvedCount}</div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: '#6b7280', marginBottom: '8px' }}>{t.rejected}</div>
            <div style={{ fontSize: '40px', fontWeight: 800 }}>{rejectedCount}</div>
          </div>
        </section>

        <section
          data-tour="absences-filters"
          style={{
            ...cardStyle,
            display: 'grid',
            gap: '16px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.2fr 1fr',
              gap: '16px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={labelStyle}>{t.year}</label>
              <select
                value={selectedYear}
                onChange={(e) => {
                  const year = Number(e.target.value)
                  setSelectedYear(year)

                  const currentMonthPart = selectedMonth.slice(5, 7)
                  setSelectedMonth(`${year}-${currentMonthPart}-01`)
                }}
                style={selectStyle}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>{t.month}</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={selectStyle}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month, localeTag)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>{t.status}</label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as 'all' | 'pending' | 'approved' | 'rejected'
                  )
                }
                style={selectStyle}
              >
                <option value="all">{t.all}</option>
                <option value="pending">{t.pending}</option>
                <option value="approved">{t.approved}</option>
                <option value="rejected">{t.rejected}</option>
              </select>
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: '12px',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#b91c1c',
                fontWeight: 600,
              }}
            >
              {error}
              <div style={{ marginTop: '5px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                {dictionary.common.technicalDetailConsole}
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: '#6b7280' }}>{t.loading}</div>
          ) : filteredItems.length === 0 ? (
            <div
              style={{
                display: 'grid',
                justifyItems: 'center',
                gap: '8px',
                padding: '28px',
                borderRadius: '22px',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                background: 'linear-gradient(135deg, rgba(248,250,252,0.96), rgba(239,246,255,0.72))',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '30px' }}>✓</div>
              <strong style={{ color: '#0f172a', fontSize: '18px' }}>{t.emptyTitle}</strong>
              <span>{t.empty}</span>
            </div>
          ) : (
            <div data-tour="absences-list" style={{ display: 'grid', gap: '14px' }}>
              {filteredItems.map((item) => {
                const isSaving = savingId === item.id

                return (
                  <article
                    key={item.id}
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.22)',
                      borderRadius: '20px',
                      padding: '18px',
                      background: 'rgba(255, 255, 255, 0.92)',
                      display: 'grid',
                      gap: '12px',
                      boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr',
                        gap: '16px',
                        alignItems: 'start',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '20px', fontWeight: 800 }}>
                          {item.employeeName}
                        </div>
                        <div style={{ color: '#6b7280', marginTop: '4px' }}>
                          {item.employeeEmail || t.noEmail}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.mode}</div>
                        <div style={{ fontWeight: 700 }}>
                          {getAbsenceModeLabel(item.absenceMode, t.modePlanned, t.modeUrgent)}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.type}</div>
                        <div style={{ fontWeight: 700 }}>
                          {getAbsenceTypeLabel(item.absenceType, t.typePlanned, t.typeSick)}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '16px',
                      }}
                    >
                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.start}</div>
                        <div>{formatDateTime(item.startAt, localeTag)}</div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.end}</div>
                        <div>{formatDateTime(item.endAt, localeTag)}</div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.submitted}</div>
                        <div>{formatDateTime(item.createdAt, localeTag)}</div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div
                        data-tour="absence-actions"
                        style={{
                          ...getStatusBadgeStyle(item.status),
                          borderRadius: '999px',
                          padding: '8px 12px',
                          fontWeight: 700,
                          fontSize: '13px',
                        }}
                      >
                        {getStatusLabel(
                          item.status,
                          t.statusPending,
                          t.statusApproved,
                          t.statusRejected
                        )}
                      </div>

                      {item.reviewedAt && (
                        <div style={{ color: '#6b7280', fontSize: '14px' }}>
                          {t.reviewed}: {formatDateTime(item.reviewedAt, localeTag)}
                        </div>
                      )}
                    </div>

                    <div>
                      <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.note}</div>
                      <div>{item.note || '—'}</div>
                    </div>

                    {item.status === 'pending' && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '10px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => updateStatus(item.id, 'approved')}
                          style={{
                            ...buttonBaseStyle,
                            background: '#111827',
                            color: '#ffffff',
                            opacity: isSaving ? 0.7 : 1,
                          }}
                        >
                          {isSaving ? t.saving : t.approve}
                        </button>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => updateStatus(item.id, 'rejected')}
                          style={{
                            ...buttonBaseStyle,
                            background: '#fee2e2',
                            color: '#b91c1c',
                            opacity: isSaving ? 0.7 : 1,
                          }}
                        >
                          {isSaving ? t.saving : t.reject}
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  )
}
