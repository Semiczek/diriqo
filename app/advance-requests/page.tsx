'use client'

import React, { useEffect, useMemo, useState } from 'react'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'
import { updateAdvanceRequestStatusAction } from './actions'

type AdvanceRequestRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  amount: number | string | null
  requested_amount: number | string | null
  reason: string | null
  note: string | null
  status: string | null
  requested_at: string | null
  approved_at: string | null
  reviewed_at: string | null
  paid_at: string | null
  payroll_month: string | null
  profiles?:
    | {
        full_name: string | null
        email: string | null
      }
    | {
        full_name: string | null
        email: string | null
      }[]
    | null
}

type AdvanceRequestView = {
  id: string
  companyId: string | null
  profileId: string | null
  employeeName: string
  employeeEmail: string
  requestedAmount: number
  amount: number
  note: string
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  requestedAt: string | null
  approvedAt: string | null
  paidAt: string | null
  payrollMonth: string | null
}

function parseNumber(value: number | string | null | undefined): number {
  if (value == null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeStatus(
  value: string | null | undefined
): 'pending' | 'approved' | 'rejected' | 'paid' {
  const normalized = (value ?? '').trim().toLowerCase()
  if (['approved', 'approve', 'accepted'].includes(normalized)) return 'approved'
  if (['rejected', 'reject', 'declined', 'denied'].includes(normalized)) return 'rejected'
  if (['paid', 'paid_out', 'payout', 'vyplaceno'].includes(normalized)) return 'paid'
  return 'pending'
}

function getProfileObject(
  value: AdvanceRequestRow['profiles']
): { full_name: string | null; email: string | null } | null {
  if (!value) return null
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(locale)
}

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function normalizePayrollMonthKey(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!match) return null
  return `${match[1]}-${match[2]}-01`
}

function getPayrollMonthFromDate(date: Date) {
  const day = date.getDate()
  if (day >= 19) {
    return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 1))
  }

  return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function getPayrollMonthFromDateString(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return getPayrollMonthFromDate(date)
}

function getCurrentPayrollMonth() {
  return monthKeyFromDate(new Date())
}

function labelFromMonthKey(monthKey: string, locale: string) {
  const date = new Date(`${monthKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey

  const formatted = date.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function normalizeRequest(row: AdvanceRequestRow): AdvanceRequestView {
  const profile = getProfileObject(row.profiles)
  const status = normalizeStatus(row.status)
  const inferredStatus =
    status === 'paid' || row.paid_at
      ? 'paid'
      : status === 'rejected'
        ? 'rejected'
        : status === 'approved' || row.approved_at
          ? 'approved'
          : 'pending'

  return {
    id: row.id,
    companyId: row.company_id,
    profileId: row.profile_id,
    employeeName: profile?.full_name || 'Neznámý pracovník',
    employeeEmail: profile?.email || '',
    requestedAmount: parseNumber(row.requested_amount ?? row.amount),
    amount: parseNumber(row.amount ?? row.requested_amount),
    note: row.reason || row.note || '',
    status: inferredStatus,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at || row.reviewed_at,
    paidAt: row.paid_at,
    payrollMonth:
      normalizePayrollMonthKey(row.payroll_month) ||
      getPayrollMonthFromDateString(row.paid_at) ||
      getPayrollMonthFromDateString(row.approved_at || row.reviewed_at) ||
      getPayrollMonthFromDateString(row.requested_at),
  }
}

function parseAmountInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return Number.NaN
  return Number(normalized)
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '24px',
  padding: '20px',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
}

const buttonBaseStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '12px',
  padding: '10px 14px',
  fontWeight: 700,
  fontSize: '14px',
  cursor: 'pointer',
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

export default function AdvanceRequestsPage() {
  const { dictionary, locale } = useI18n()
  const t = dictionary.advanceRequests
  const localeTag = locale === 'cs' ? 'cs-CZ' : locale === 'de' ? 'de-DE' : 'en-US'
  const currentPayrollMonth = getCurrentPayrollMonth()
  const initialYear = new Date(`${currentPayrollMonth}T00:00:00`).getFullYear()

  const [items, setItems] = useState<AdvanceRequestView[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [selectedYear, setSelectedYear] = useState(initialYear)
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(currentPayrollMonth)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'approved' | 'rejected' | 'paid'
  >('all')

  async function loadData() {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('advance_requests')
      .select(`
        id,
        company_id,
        profile_id,
        amount,
        requested_amount,
        reason,
        note,
        status,
        requested_at,
        approved_at,
        reviewed_at,
        paid_at,
        payroll_month,
        profiles:profile_id (
          full_name,
          email
        )
      `)
      .order('requested_at', { ascending: false })

    if (error) {
      console.error('Advance requests load failed', error)
      setError('Data se nepodařilo načíst.')
      setLoading(false)
      return
    }

    const normalized = (((data ?? []) as unknown) as AdvanceRequestRow[]).map(
      normalizeRequest
    )

    setItems(normalized)
    setAmountDrafts(
      Object.fromEntries(
        normalized.map((item) => [item.id, String(item.amount || item.requestedAmount || '')])
      )
    )
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const yearOptions = useMemo(() => {
    const years = new Set<number>()
    years.add(selectedYear)
    years.add(selectedYear - 1)
    years.add(selectedYear + 1)

    for (const item of items) {
      if (!item.payrollMonth) continue
      const date = new Date(`${item.payrollMonth}T00:00:00`)
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
      const isWorkflowRequest =
        item.status === 'pending' || item.status === 'approved' || item.status === 'rejected'
      const matchesMonth = isWorkflowRequest || item.payrollMonth === selectedPayrollMonth
      const matchesStatus =
        statusFilter === 'all' ? true : item.status === statusFilter

      return matchesMonth && matchesStatus
    })
  }, [items, selectedPayrollMonth, statusFilter])

  const pendingCount = filteredItems.filter((item) => item.status === 'pending').length
  const approvedCount = filteredItems.filter((item) => item.status === 'approved').length
  const rejectedCount = filteredItems.filter((item) => item.status === 'rejected').length
  const paidCount = filteredItems.filter((item) => item.status === 'paid').length

  const totalAmount = filteredItems.reduce((sum, item) => sum + item.amount, 0)

  function getDraftAmount(item: AdvanceRequestView) {
    return amountDrafts[item.id] ?? String(item.amount || item.requestedAmount || '')
  }

  async function updateRequestStatus(
    item: AdvanceRequestView,
    nextStatus: 'approved' | 'rejected' | 'paid',
    overrideAmount: number
  ) {
    setSavingId(item.id)
    setError(null)

    try {
      const result = await updateAdvanceRequestStatusAction({
        requestId: item.id,
        status: nextStatus,
        amount: overrideAmount,
      })

      if (!result.ok) {
        throw new Error(result.error)
      }

      const updatedItem: AdvanceRequestView = {
        ...item,
        amount: nextStatus === 'rejected' ? item.amount : overrideAmount,
        status: nextStatus,
        approvedAt: result.data.approvedAt,
        paidAt: result.data.paidAt,
        payrollMonth: result.data.payrollMonth,
      }

      setItems((prev) =>
        prev.map((current) => {
          if (current.id !== item.id) return current
          return updatedItem
        })
      )
      setAmountDrafts((current) => ({
        ...current,
        [item.id]: String(updatedItem.amount),
      }))
    } catch (err: unknown) {
      console.error('Advance request update failed', err)
      setError('Data se nepodarilo ulozit.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <DashboardShell activeItem="advanceRequests">
      <main
        style={{
          display: 'grid',
          gap: '20px',
          maxWidth: '1200px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <section
          style={{
            ...cardStyle,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '28px',
            background:
              'radial-gradient(circle at 8% 8%, rgba(249, 115, 22, 0.14), transparent 30%), radial-gradient(circle at 100% 0%, rgba(124, 58, 237, 0.14), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,247,237,0.88) 52%, rgba(239,246,255,0.88))',
            padding: '30px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              borderRadius: '999px',
              padding: '7px 11px',
              marginBottom: '14px',
              background: 'rgba(249, 115, 22, 0.1)',
              border: '1px solid rgba(249, 115, 22, 0.22)',
              color: '#c2410c',
              fontSize: '12px',
              fontWeight: 850,
            }}
          >
            Finance týmu
          </div>
          <h1
            style={{
              margin: '0 0 8px 0',
              fontSize: '42px',
              lineHeight: 1.05,
              color: '#020617',
            }}
          >
            {t.title}
          </h1>

          <p
            style={{
              margin: 0,
              color: '#475569',
              fontSize: '16px',
              lineHeight: 1.6,
              maxWidth: '640px',
            }}
          >
            {t.subtitle}
          </p>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: '16px',
          }}
        >
          <div style={cardStyle}>
            <div style={{ color: '#6b7280', marginBottom: '8px' }}>
              {t.pending}
            </div>
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

          <div style={cardStyle}>
            <div style={{ color: '#6b7280', marginBottom: '8px' }}>{t.totalAmount}</div>
            <div style={{ fontSize: '40px', fontWeight: 800 }}>
              {formatCurrency(totalAmount, localeTag)}
            </div>
          </div>
        </section>

        <section
          style={{
            ...cardStyle,
            display: 'grid',
            gap: '16px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.2fr 1fr 1fr',
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

                  const currentMonthPart = selectedPayrollMonth.slice(5, 7)
                  setSelectedPayrollMonth(`${year}-${currentMonthPart}-01`)
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
              <label style={labelStyle}>{t.payrollMonth}</label>
              <select
                value={selectedPayrollMonth}
                onChange={(e) => setSelectedPayrollMonth(e.target.value)}
                style={selectStyle}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {labelFromMonthKey(month, localeTag)}
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
                    e.target.value as
                      | 'all'
                      | 'pending'
                      | 'approved'
                      | 'rejected'
                      | 'paid'
                  )
                }
                style={selectStyle}
              >
                <option value="all">{t.all}</option>
                <option value="pending">{t.pending}</option>
                <option value="approved">{t.approved}</option>
                <option value="rejected">{t.rejected}</option>
                <option value="paid">{t.paid}</option>
              </select>
            </div>

            <div style={{ alignSelf: 'center', color: '#6b7280', fontSize: '15px' }}>
              {t.paidCount}: <strong style={{ color: '#111827' }}>{paidCount}</strong>
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
                Technický detail je v konzoli.
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
                background: 'linear-gradient(135deg, rgba(248,250,252,0.96), rgba(255,247,237,0.74))',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '30px' }}>Kč</div>
              <strong style={{ color: '#0f172a', fontSize: '18px' }}>Žádné žádosti o zálohu.</strong>
              <span>{t.empty}</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '14px' }}>
              {filteredItems.map((item) => {
                const isSaving = savingId === item.id
                const parsedDraftAmount = parseAmountInput(getDraftAmount(item))

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
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
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
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.amount}</div>
                        {item.status === 'pending' || item.status === 'approved' ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={getDraftAmount(item)}
                              onChange={(e) =>
                                setAmountDrafts((current) => ({
                                  ...current,
                                  [item.id]: e.target.value,
                                }))
                              }
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: '10px',
                                border: '1px solid #d1d5db',
                                fontSize: '16px',
                                fontWeight: 700,
                              }}
                            />
                            <div style={{ color: '#6b7280', fontSize: '13px' }}>
                              {t.requestedAmount}: {formatCurrency(item.requestedAmount, localeTag)}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <div style={{ fontWeight: 800, fontSize: '24px' }}>
                              {formatCurrency(item.amount, localeTag)}
                            </div>
                            <div style={{ color: '#6b7280', fontSize: '13px' }}>
                              {t.requestedAmount}: {formatCurrency(item.requestedAmount, localeTag)}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.status}</div>
                        <div style={{ fontWeight: 700 }}>
                          {item.status === 'pending'
                            ? t.statusPending
                            : item.status === 'approved'
                              ? t.statusApproved
                              : item.status === 'rejected'
                                ? t.statusRejected
                                : t.statusPaid}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>
                          {t.payrollMonth}
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          {item.payrollMonth ? labelFromMonthKey(item.payrollMonth, localeTag) : '—'}
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
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.requestedAt}</div>
                        <div>{formatDateTime(item.requestedAt, localeTag)}</div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.approvedAt}</div>
                        <div>{formatDateTime(item.approvedAt, localeTag)}</div>
                      </div>

                      <div>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.paidAt}</div>
                        <div>{formatDateTime(item.paidAt, localeTag)}</div>
                      </div>
                    </div>

                    <div>
                      <div style={{ color: '#6b7280', marginBottom: '4px' }}>{t.note}</div>
                      <div>{item.note || '—'}</div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {item.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            disabled={isSaving || !Number.isFinite(parsedDraftAmount) || parsedDraftAmount <= 0}
                            onClick={() =>
                              updateRequestStatus(item, 'approved', parsedDraftAmount)
                            }
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
                            onClick={() =>
                              updateRequestStatus(item, 'rejected', item.amount)
                            }
                            style={{
                              ...buttonBaseStyle,
                              background: '#fee2e2',
                              color: '#b91c1c',
                              opacity: isSaving ? 0.7 : 1,
                            }}
                          >
                          {isSaving ? t.saving : t.reject}
                          </button>
                        </>
                      )}

                      {item.status === 'approved' && (
                        <button
                          type="button"
                          disabled={isSaving || !Number.isFinite(parsedDraftAmount) || parsedDraftAmount <= 0}
                          onClick={() =>
                            updateRequestStatus(item, 'paid', parsedDraftAmount)
                          }
                          style={{
                            ...buttonBaseStyle,
                            background: '#dcfce7',
                            color: '#166534',
                            opacity: isSaving ? 0.7 : 1,
                          }}
                        >
                          {isSaving ? t.saving : t.markPaid}
                        </button>
                      )}

                    </div>
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

