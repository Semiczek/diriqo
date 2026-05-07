'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

type EditWorkerFinancePageProps = {
  params: Promise<{
    workerId: string
  }>
}

type WorkerAdvanceRow = {
  id: string
  profile_id: string | null
  amount: number | null
  issued_at: string | null
  note: string | null
  created_at?: string | null
}

type PayrollItemType = 'bonus' | 'meal' | 'deduction'

type PayrollItemRow = {
  id: string
  profile_id: string | null
  payroll_month: string | null
  item_type: PayrollItemType | string | null
  amount: number | string | null
  note: string | null
  created_at?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function getTodayMonthInputValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function isValidMonth(value: string | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

function getPayrollItemLabel(type: string | null, labels: Record<PayrollItemType, string>) {
  if (type === 'bonus' || type === 'meal' || type === 'deduction') {
    return labels[type]
  }

  return type || '—'
}

export default function EditWorkerFinancePage({
  params,
}: EditWorkerFinancePageProps) {
  const router = useRouter()
  const { dictionary } = useI18n()

  const [workerId, setWorkerId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [defaultHourlyRate, setDefaultHourlyRate] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingWorker, setSavingWorker] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [advances, setAdvances] = useState<WorkerAdvanceRow[]>([])
  const [payrollMonth, setPayrollMonth] = useState(getTodayMonthInputValue())
  const [payrollItemType, setPayrollItemType] = useState<PayrollItemType>('bonus')
  const [payrollItemAmount, setPayrollItemAmount] = useState('')
  const [payrollItemNote, setPayrollItemNote] = useState('')
  const [savingPayrollItem, setSavingPayrollItem] = useState(false)
  const [payrollItems, setPayrollItems] = useState<PayrollItemRow[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadPage() {
      try {
        setLoading(true)
        setError(null)

        const resolvedParams = await params
        const resolvedWorkerId = resolvedParams.workerId
        const monthFromUrl =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('month')
            : null
        const initialPayrollMonth = isValidMonth(monthFromUrl)
          ? String(monthFromUrl)
          : getTodayMonthInputValue()

        if (cancelled) return

        setWorkerId(resolvedWorkerId)
        setPayrollMonth(initialPayrollMonth)

        const [profileResponse, advancesResponse, payrollItemsResponse] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, email, default_hourly_rate')
            .eq('id', resolvedWorkerId)
            .maybeSingle(),

          supabase
            .from('worker_advances')
            .select('id, profile_id, amount, issued_at, note, created_at')
            .eq('profile_id', resolvedWorkerId)
            .order('issued_at', { ascending: false })
            .order('created_at', { ascending: false }),

          supabase
            .from('payroll_items')
            .select('id, profile_id, payroll_month, item_type, amount, note, created_at')
            .eq('profile_id', resolvedWorkerId)
            .order('payroll_month', { ascending: false })
            .order('created_at', { ascending: false }),
        ])

        if (profileResponse.error) {
          throw new Error(profileResponse.error.message)
        }

        if (!profileResponse.data) {
          throw new Error(dictionary.workers.financeEdit.workerNotFound)
        }

        if (advancesResponse.error) {
          throw new Error(advancesResponse.error.message)
        }

        if (payrollItemsResponse.error) {
          throw new Error(payrollItemsResponse.error.message)
        }

        if (cancelled) return

        setFullName(profileResponse.data.full_name ?? '')
        setEmail(profileResponse.data.email ?? '')
        setDefaultHourlyRate(
          profileResponse.data.default_hourly_rate != null
            ? String(profileResponse.data.default_hourly_rate)
            : ''
        )
        setAdvances((advancesResponse.data ?? []) as WorkerAdvanceRow[])
        setPayrollItems((payrollItemsResponse.data ?? []) as PayrollItemRow[])
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err, dictionary.workers.financeEdit.loadFailed))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadPage()

    return () => {
      cancelled = true
    }
  }, [dictionary.workers.financeEdit.loadFailed, dictionary.workers.financeEdit.workerNotFound, params])

  const totalAdvances = useMemo(() => {
    return advances.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
  }, [advances])

  const payrollItemsForMonth = useMemo(() => {
    return payrollItems.filter((item) => item.payroll_month === payrollMonth)
  }, [payrollItems, payrollMonth])

  const payrollTotals = useMemo(() => {
    return payrollItemsForMonth.reduce(
      (totals, item) => {
        const amount = Number(item.amount ?? 0)

        if (item.item_type === 'bonus') totals.bonus += amount
        if (item.item_type === 'meal') totals.meal += amount
        if (item.item_type === 'deduction') totals.deduction += amount

        return totals
      },
      { bonus: 0, meal: 0, deduction: 0 },
    )
  }, [payrollItemsForMonth])

  const payrollItemLabels = useMemo(
    () => ({
      bonus: dictionary.workers.financeEdit.bonus,
      meal: dictionary.workers.financeEdit.mealAllowance,
      deduction: dictionary.workers.financeEdit.deduction,
    }),
    [
      dictionary.workers.financeEdit.bonus,
      dictionary.workers.financeEdit.mealAllowance,
      dictionary.workers.financeEdit.deduction,
    ],
  )

  async function handleSaveWorker(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!workerId) return

    try {
      setSavingWorker(true)
      setError(null)
      setSuccessMessage(null)

      const trimmedFullName = fullName.trim()
      const trimmedEmail = email.trim()
      const parsedRate =
        defaultHourlyRate.trim() === '' ? null : Number(defaultHourlyRate)

      if (!trimmedFullName) {
        throw new Error(dictionary.workers.financeEdit.nameRequired)
      }

      if (parsedRate != null && Number.isNaN(parsedRate)) {
        throw new Error(dictionary.workers.financeEdit.invalidRate)
      }

      const updateResponse = await supabase
        .from('profiles')
        .update({
          full_name: trimmedFullName,
          email: trimmedEmail || null,
          default_hourly_rate: parsedRate,
        })
        .eq('id', workerId)

      if (updateResponse.error) {
        throw new Error(updateResponse.error.message)
      }

      setSuccessMessage(dictionary.workers.financeEdit.saveWorkerSuccess)
      router.refresh()
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary.workers.financeEdit.saveWorkerFailed))
    } finally {
      setSavingWorker(false)
    }
  }

  async function reloadPayrollItems(targetWorkerId: string) {
    const reloadResponse = await supabase
      .from('payroll_items')
      .select('id, profile_id, payroll_month, item_type, amount, note, created_at')
      .eq('profile_id', targetWorkerId)
      .order('payroll_month', { ascending: false })
      .order('created_at', { ascending: false })

    if (reloadResponse.error) {
      throw new Error(reloadResponse.error.message)
    }

    setPayrollItems((reloadResponse.data ?? []) as PayrollItemRow[])
  }

  async function handleCreatePayrollItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!workerId) return

    try {
      setSavingPayrollItem(true)
      setError(null)
      setSuccessMessage(null)

      const parsedAmount = Number(payrollItemAmount)

      if (!isValidMonth(payrollMonth)) {
        throw new Error(dictionary.workers.financeEdit.payrollMonthRequired)
      }

      if (!payrollItemAmount.trim()) {
        throw new Error(dictionary.workers.financeEdit.payrollItemAmountRequired)
      }

      if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
        throw new Error(dictionary.workers.financeEdit.payrollItemAmountInvalid)
      }

      const insertResponse = await supabase.from('payroll_items').insert({
        profile_id: workerId,
        payroll_month: payrollMonth,
        item_type: payrollItemType,
        amount: parsedAmount,
        note: payrollItemNote.trim() || null,
      })

      if (insertResponse.error) {
        throw new Error(insertResponse.error.message)
      }

      await reloadPayrollItems(workerId)
      setPayrollItemAmount('')
      setPayrollItemNote('')
      setSuccessMessage(dictionary.workers.financeEdit.savePayrollItemSuccess)
      router.refresh()
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary.workers.financeEdit.savePayrollItemFailed))
    } finally {
      setSavingPayrollItem(false)
    }
  }

  async function handleDeletePayrollItem(payrollItemId: string) {
    const confirmed = window.confirm(dictionary.workers.financeEdit.deletePayrollItemConfirm)

    if (!confirmed) return

    try {
      setError(null)
      setSuccessMessage(null)

      const deleteResponse = await supabase
        .from('payroll_items')
        .delete()
        .eq('id', payrollItemId)

      if (deleteResponse.error) {
        throw new Error(deleteResponse.error.message)
      }

      setPayrollItems((current) => current.filter((item) => item.id !== payrollItemId))
      setSuccessMessage(dictionary.workers.financeEdit.deletePayrollItemSuccess)
      router.refresh()
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary.workers.financeEdit.deletePayrollItemFailed))
    }
  }

  const boxStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    background: '#ffffff',
    padding: '28px',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    padding: '14px 16px',
    fontSize: '16px',
    color: '#111827',
    background: '#ffffff',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '14px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '8px',
  }

  const primaryButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    border: 'none',
    borderRadius: '12px',
    background: '#111827',
    color: '#ffffff',
    padding: '14px 18px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    display: 'inline-block',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    background: '#ffffff',
    color: '#111827',
    padding: '14px 18px',
    fontSize: '16px',
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  }

  const tableWrapStyle: React.CSSProperties = {
    overflowX: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    background: '#ffffff',
  }

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '640px',
  }

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    fontSize: '13px',
    color: '#6b7280',
    fontWeight: 700,
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
  }

  const tdStyle: React.CSSProperties = {
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '14px',
    color: '#111827',
    verticalAlign: 'top',
  }

  if (loading) {
    return (
      <DashboardShell activeItem="workers">
        <main
          style={{
            maxWidth: '1100px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            color: '#111827',
          }}
        >
          <div style={boxStyle}>{dictionary.workers.financeEdit.loading}</div>
        </main>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell activeItem="workers">
      <main
        style={{
          maxWidth: '1100px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <Link
            href={workerId ? `/workers/${workerId}?month=${payrollMonth}` : '/workers'}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              color: '#374151',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            {dictionary.workers.financeEdit.backToWorker}
          </Link>
        </div>

        {error ? (
          <div
            style={{
              marginBottom: '20px',
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: '16px',
              padding: '16px 18px',
            }}
          >
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div
            style={{
              marginBottom: '20px',
              border: '1px solid #bbf7d0',
              background: '#f0fdf4',
              color: '#166534',
              borderRadius: '16px',
              padding: '16px 18px',
            }}
          >
            {successMessage}
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '20px',
          }}
        >
          <section style={boxStyle}>
            <h1
              style={{
                margin: '0 0 10px 0',
                fontSize: '56px',
                lineHeight: 1,
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {dictionary.workers.financeEdit.title}
            </h1>

            <p
              style={{
                margin: '0 0 28px 0',
                fontSize: '15px',
                color: '#6b7280',
              }}
            >
              {dictionary.workers.financeEdit.subtitle}
            </p>

            <form onSubmit={handleSaveWorker}>
              <div style={{ display: 'grid', gap: '18px' }}>
                <div>
                  <label htmlFor="fullName" style={labelStyle}>
                    {dictionary.workers.financeEdit.fullName}
                  </label>
                  <input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="email" style={labelStyle}>
                    {dictionary.workers.detail.email}
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="defaultHourlyRate" style={labelStyle}>
                    {dictionary.workers.financeEdit.defaultRate}
                  </label>
                  <input
                    id="defaultHourlyRate"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={defaultHourlyRate}
                    onChange={(e) => setDefaultHourlyRate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    flexWrap: 'wrap',
                    marginTop: '8px',
                  }}
                >
                  <button type="submit" style={primaryButtonStyle} disabled={savingWorker}>
                    {savingWorker
                      ? dictionary.workers.financeEdit.saving
                      : dictionary.workers.financeEdit.saveChanges}
                  </button>

                  <Link href={workerId ? `/workers/${workerId}?month=${payrollMonth}` : '/workers'} style={secondaryButtonStyle}>
                    {dictionary.workers.financeEdit.cancel}
                  </Link>
                </div>
              </div>
            </form>
          </section>

          <section style={boxStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '24px',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '30px',
                    lineHeight: 1.1,
                    color: '#111827',
                  }}
                >
                  {dictionary.workers.financeEdit.payrollItems}
                </h2>

                <p
                  style={{
                    margin: '10px 0 0 0',
                    fontSize: '15px',
                    color: '#6b7280',
                  }}
                >
                  {dictionary.workers.financeEdit.payrollItemsDescription}
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))',
                  gap: '10px',
                  minWidth: '360px',
                }}
              >
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '12px', background: '#f9fafb' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.financeEdit.bonus}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{formatCurrency(payrollTotals.bonus)}</div>
                </div>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '12px', background: '#f9fafb' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.financeEdit.mealAllowance}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{formatCurrency(payrollTotals.meal)}</div>
                </div>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '12px', background: '#f9fafb' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{dictionary.workers.financeEdit.deduction}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{formatCurrency(payrollTotals.deduction)}</div>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreatePayrollItem}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '18px',
                  marginBottom: '18px',
                }}
              >
                <div>
                  <label htmlFor="payrollMonth" style={labelStyle}>
                    {dictionary.workers.financeEdit.payrollMonth}
                  </label>
                  <input
                    id="payrollMonth"
                    type="month"
                    value={payrollMonth}
                    onChange={(e) => setPayrollMonth(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="payrollItemType" style={labelStyle}>
                    {dictionary.workers.financeEdit.payrollItemType}
                  </label>
                  <select
                    id="payrollItemType"
                    value={payrollItemType}
                    onChange={(e) => setPayrollItemType(e.target.value as PayrollItemType)}
                    style={inputStyle}
                  >
                    <option value="bonus">{dictionary.workers.financeEdit.bonus}</option>
                    <option value="meal">{dictionary.workers.financeEdit.mealAllowance}</option>
                    <option value="deduction">{dictionary.workers.financeEdit.deduction}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="payrollItemAmount" style={labelStyle}>
                    {dictionary.workers.financeEdit.payrollItemAmount}
                  </label>
                  <input
                    id="payrollItemAmount"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={payrollItemAmount}
                    onChange={(e) => setPayrollItemAmount(e.target.value)}
                    style={inputStyle}
                    placeholder={dictionary.workers.financeEdit.payrollItemAmountPlaceholder}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label htmlFor="payrollItemNote" style={labelStyle}>
                  {dictionary.workers.financeEdit.note}
                </label>
                <textarea
                  id="payrollItemNote"
                  value={payrollItemNote}
                  onChange={(e) => setPayrollItemNote(e.target.value)}
                  style={{
                    ...inputStyle,
                    minHeight: '90px',
                    resize: 'vertical',
                  }}
                  placeholder={dictionary.workers.financeEdit.payrollItemNotePlaceholder}
                />
              </div>

              <button type="submit" style={primaryButtonStyle} disabled={savingPayrollItem}>
                {savingPayrollItem
                  ? dictionary.workers.financeEdit.savingPayrollItem
                  : dictionary.workers.financeEdit.savePayrollItem}
              </button>
            </form>

            <div style={{ marginTop: '24px' }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '22px' }}>
                {dictionary.workers.financeEdit.payrollItemsHistory}
              </h3>

              {payrollItemsForMonth.length === 0 ? (
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '14px',
                    padding: '18px',
                    background: '#f9fafb',
                    color: '#6b7280',
                  }}
                >
                  {dictionary.workers.financeEdit.noPayrollItems}
                </div>
              ) : (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>{dictionary.workers.financeEdit.payrollItemType}</th>
                        <th style={thStyle}>{dictionary.workers.detail.amount}</th>
                        <th style={thStyle}>{dictionary.workers.financeEdit.note}</th>
                        <th style={thStyle}>{dictionary.workers.financeEdit.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollItemsForMonth.map((item) => (
                        <tr key={item.id}>
                          <td style={tdStyle}>{getPayrollItemLabel(item.item_type, payrollItemLabels)}</td>
                          <td style={tdStyle}>{formatCurrency(Number(item.amount ?? 0))}</td>
                          <td style={tdStyle}>{item.note?.trim() ? item.note : '—'}</td>
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => handleDeletePayrollItem(item.id)}
                              style={{
                                border: '1px solid #fecaca',
                                background: '#ffffff',
                                color: '#b91c1c',
                                borderRadius: '10px',
                                padding: '10px 12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {dictionary.workers.financeEdit.delete}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section style={boxStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '20px',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '30px',
                    lineHeight: 1.1,
                    color: '#111827',
                  }}
                >
                  Zálohy jsou v přehledu pracovníka
                </h2>

                <p
                  style={{
                    margin: '10px 0 0 0',
                    fontSize: '15px',
                    color: '#6b7280',
                  }}
                >
                  Přidávání a mazání záloh se teď řeší přímo v detailu pracovníka, aby sedělo s interním / externím režimem a výplatním nastavením.
                </p>
              </div>

              <div
                style={{
                  minWidth: '220px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '14px',
                  padding: '14px 16px',
                  background: '#f9fafb',
                }}
              >
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                  Evidované zálohy
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>
                  {formatCurrency(totalAdvances)}
                </div>
              </div>
            </div>

            <Link href={workerId ? `/workers/${workerId}?month=${payrollMonth}` : '/workers'} style={primaryButtonStyle}>
              Otevřít přehled pracovníka
            </Link>
          </section>
        </div>
      </main>
    </DashboardShell>
  )
}
