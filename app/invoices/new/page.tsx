import Link from 'next/link'

import { createInvoiceFromJobs } from '@/app/invoices/actions'
import DashboardShell from '@/components/DashboardShell'
import {
  DEFAULT_INVOICE_DUE_DAYS,
  DEFAULT_INVOICE_VAT_RATE,
  NON_VAT_PAYER_NOTE,
  addDaysToDate,
  calculateInvoiceItem,
  formatCurrency,
  sumInvoiceTotals,
  toDateInputValue,
} from '@/lib/invoices'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  searchParams: Promise<{
    customerId?: string
    month?: string
  }>
}

type CustomerRow = {
  id: string
  name: string | null
}

type JobRow = {
  id: string
  title: string | null
  description: string | null
  price: number | null
  start_at: string | null
  end_at: string | null
  status: string | null
}

type JobStateRow = {
  id: string
  work_state: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function getCurrentMonthValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function normalizeMonthValue(value: string | undefined) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return value
  }

  return getCurrentMonthValue()
}

function isJobInMonth(job: JobRow, monthValue: string) {
  const [yearText, monthText] = monthValue.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return false
  }

  const relevantDate = job.end_at ?? job.start_at
  if (!relevantDate) return false

  const parsedDate = new Date(relevantDate)
  if (Number.isNaN(parsedDate.getTime())) return false

  return parsedDate.getFullYear() === year && parsedDate.getMonth() === monthIndex
}

export default async function NewInvoicePage({ searchParams }: PageProps) {
  const activeCompany = await requireHubAccess()
  const { customerId = '', month } = await searchParams
  const selectedMonth = normalizeMonthValue(month)
  const supabase = await createSupabaseServerClient()

  const customersResponse = await supabase
    .from('customers')
    .select('id, name')
    .eq('company_id', activeCompany.companyId)
    .order('name', { ascending: true })

  const companyResponse = await supabase
    .from('companies')
    .select('vat_number')
    .eq('id', activeCompany.companyId)
    .maybeSingle()
  const isVatPayer = Boolean(companyResponse.data?.vat_number?.trim())
  const defaultVatRate = isVatPayer ? DEFAULT_INVOICE_VAT_RATE : 0

  let availableJobs: Array<JobRow & { calculatedTotal: number }> = []
  let unavailableMessage: string | null = null

  if (customerId) {
    const [jobsResponse, statesResponse, activeLinksResponse] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, title, description, price, start_at, end_at, status')
        .eq('company_id', activeCompany.companyId)
        .eq('customer_id', customerId)
        .order('end_at', { ascending: false, nullsFirst: false })
        .order('start_at', { ascending: false, nullsFirst: false }),
      supabase.from('jobs_with_state').select('id, work_state'),
      supabase
        .from('invoice_jobs')
        .select('job_id')
        .eq('company_id', activeCompany.companyId)
        .eq('is_active', true),
    ])

    if (jobsResponse.error) {
      unavailableMessage = jobsResponse.error.message
    } else if (statesResponse.error) {
      unavailableMessage = statesResponse.error.message
    } else if (activeLinksResponse.error) {
      unavailableMessage = activeLinksResponse.error.message
    } else {
      const stateByJobId = new Map(
        ((statesResponse.data ?? []) as JobStateRow[]).map((state) => [state.id, state.work_state])
      )
      const invoicedJobIds = new Set(
        ((activeLinksResponse.data ?? []) as Array<{ job_id: string }>).map((item) => item.job_id)
      )

      availableJobs = ((jobsResponse.data ?? []) as JobRow[])
        .filter((job) => (stateByJobId.get(job.id) === 'done' || job.status === 'done') && !invoicedJobIds.has(job.id))
        .filter((job) => isJobInMonth(job, selectedMonth))
        .filter((job) => Number(job.price ?? 0) > 0)
        .map((job) => ({
          ...job,
          calculatedTotal: calculateInvoiceItem(job.price, defaultVatRate).totalWithVat,
        }))
    }
  }

  const totals = sumInvoiceTotals(
    availableJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate))
  )
  const today = new Date()
  const dueDate = addDaysToDate(today, DEFAULT_INVOICE_DUE_DAYS)

  return (
    <DashboardShell activeItem="invoices">
      <main style={{ display: 'grid', gap: '20px', color: '#111827' }}>
        <div>
          <Link href="/invoices" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 800 }}>
            Zpět na fakturaci
          </Link>
          <h1 style={{ margin: '18px 0 8px 0', fontSize: '36px' }}>Nová faktura</h1>
          <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.6 }}>
            Vyberte zákazníka a hotové nevyfakturované zakázky. Ceny se při vytvoření znovu ověří na serveru.
          </p>
        </div>

        <form
          method="get"
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            padding: '16px',
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) minmax(180px, 240px) auto',
            gap: '12px',
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'grid', gap: '8px', fontWeight: 700 }}>
            <span>Zákazník</span>
            <select
              name="customerId"
              defaultValue={customerId}
              style={{ height: '44px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 12px' }}
            >
              <option value="">Vyberte zákazníka</option>
              {((customersResponse.data ?? []) as CustomerRow[]).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name ?? 'Zákazník bez názvu'}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '8px', fontWeight: 700 }}>
            <span>Měsíc</span>
            <input
              type="month"
              name="month"
              defaultValue={selectedMonth}
              style={{ height: '44px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 12px' }}
            />
          </label>

          <button
            type="submit"
            style={{
              height: '44px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              padding: '0 16px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Zobrazit zakázky
          </button>
        </form>

        {customersResponse.error ? (
          <div style={{ border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '14px' }}>
            {customersResponse.error.message}
          </div>
        ) : null}

        {unavailableMessage ? (
          <div style={{ border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '14px' }}>
            {unavailableMessage}
          </div>
        ) : null}

        {customerId ? (
          <form action={createInvoiceFromJobs} style={{ display: 'grid', gap: '16px' }}>
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="month" value={selectedMonth} />

            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                padding: '16px',
                display: 'grid',
                gap: '14px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '22px' }}>Doklad</h2>
              {!isVatPayer ? (
                <div
                  style={{
                    border: '1px solid #fde68a',
                    backgroundColor: '#fef9c3',
                    color: '#854d0e',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    fontWeight: 800,
                  }}
                >
                  {NON_VAT_PAYER_NOTE} Proto se faktura vytvoří s DPH 0 %.
                </div>
              ) : null}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '12px',
                }}
              >
                <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                  <span>Datum vystavení</span>
                  <input
                    type="date"
                    name="issueDate"
                    defaultValue={toDateInputValue(today)}
                    style={{ height: '42px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 12px' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                  <span>DUZP</span>
                  <input
                    type="date"
                    name="taxableSupplyDate"
                    defaultValue={toDateInputValue(today)}
                    style={{ height: '42px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 12px' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                  <span>Splatnost</span>
                  <input
                    type="date"
                    name="dueDate"
                    defaultValue={toDateInputValue(dueDate)}
                    style={{ height: '42px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 12px' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                  <span>Sazba DPH (%)</span>
                  <input
                    type="number"
                    name="vatRate"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={defaultVatRate}
                    disabled={!isVatPayer}
                    style={{
                      height: '42px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      padding: '0 12px',
                      backgroundColor: isVatPayer ? '#ffffff' : '#f3f4f6',
                    }}
                  />
                </label>
              </div>
              <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                <span>Poznámka</span>
                <textarea
                  name="note"
                  rows={3}
                  style={{ borderRadius: '8px', border: '1px solid #d1d5db', padding: '10px 12px', resize: 'vertical' }}
                />
              </label>
            </section>

            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                overflowX: 'auto',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '12px', width: '44px' }} />
                    <th style={{ padding: '12px' }}>Zakázka</th>
                    <th style={{ padding: '12px' }}>Termín</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Cena bez DPH</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Celkem s DPH</th>
                  </tr>
                </thead>
                <tbody>
                  {availableJobs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '18px', color: '#6b7280' }}>
                        Pro zákazníka nejsou hotové nevyfakturované zakázky s vyplněnou cenou.
                      </td>
                    </tr>
                  ) : (
                    availableJobs.map((job) => (
                      <tr key={job.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px' }}>
                          <input type="checkbox" name="jobIds" value={job.id} defaultChecked />
                        </td>
                        <td style={{ padding: '12px' }}>
                          <strong>{job.title ?? 'Zakázka bez názvu'}</strong>
                          <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px' }}>
                            {job.description ?? '-'}
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          {formatDate(job.start_at)} - {formatDate(job.end_at)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                          {formatCurrency(job.price)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                          {formatCurrency(job.calculatedTotal)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>

            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                padding: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'grid', gap: '4px' }}>
                <strong>Součet vybraných zakázek v náhledu</strong>
                <span style={{ color: '#6b7280' }}>
                  Bez DPH {formatCurrency(totals.subtotalWithoutVat)} | DPH {defaultVatRate}% {formatCurrency(totals.vatTotal)} | Celkem{' '}
                  {formatCurrency(totals.totalWithVat)}
                </span>
              </div>
              <button
                type="submit"
                disabled={availableJobs.length === 0}
                style={{
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: availableJobs.length === 0 ? '#9ca3af' : '#111827',
                  color: '#ffffff',
                  padding: '12px 16px',
                  fontWeight: 800,
                  cursor: availableJobs.length === 0 ? 'default' : 'pointer',
                }}
              >
                Vytvořit fakturu
              </button>
            </section>
          </form>
        ) : null}
      </main>
    </DashboardShell>
  )
}
