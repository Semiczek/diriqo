import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'

import { createInvoiceFromJobs } from '@/app/invoices/actions'
import DashboardShell from '@/components/DashboardShell'
import InvoiceOverviewFilterForm from './InvoiceOverviewFilterForm'
import {
  alertSurface as alertStyle,
  panelSurface as panelStyle,
  sectionTitle as sectionTitleStyle,
} from '@/components/ui/styles'
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
  customer_id: string | null
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

type InvoiceReadyJob = JobRow & {
  calculatedTotal: number
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

function getPreviousMonthValue(monthValue: string) {
  const [yearText, monthText] = monthValue.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return getCurrentMonthValue()

  const date = new Date(year, monthIndex - 1, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthValue: string) {
  const [yearText, monthText] = monthValue.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return monthValue

  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, monthIndex, 1))
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

function buildCustomerJobGroups(
  jobs: InvoiceReadyJob[],
  customerById: Map<string, CustomerRow>,
  vatRate: number
) {
  const jobsByCustomer = new Map<string, InvoiceReadyJob[]>()
  for (const job of jobs) {
    if (!job.customer_id) continue
    const groupJobs = jobsByCustomer.get(job.customer_id) ?? []
    groupJobs.push(job)
    jobsByCustomer.set(job.customer_id, groupJobs)
  }

  return Array.from(jobsByCustomer.entries())
    .map(([groupCustomerId, groupJobs]) => {
      const groupTotals = sumInvoiceTotals(groupJobs.map((job) => calculateInvoiceItem(job.price, vatRate)))
      return {
        customerId: groupCustomerId,
        customerName: customerById.get(groupCustomerId)?.name ?? 'Zákazník bez názvu',
        jobs: groupJobs,
        totals: groupTotals,
      }
    })
    .sort((left, right) => right.totals.totalWithVat - left.totals.totalWithVat)
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: '18px',
  width: '100%',
  maxWidth: '1180px',
  margin: '0 auto',
  padding: '2px 0 48px',
  color: '#111827',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '24px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 7px',
  color: '#2563eb',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '38px',
  lineHeight: 1.08,
  fontWeight: 900,
}

const subtitleStyle: CSSProperties = {
  margin: '9px 0 0',
  color: '#64748b',
  fontSize: '16px',
  lineHeight: 1.55,
  fontWeight: 650,
  maxWidth: '760px',
}

const backLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '40px',
  padding: '9px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
}

export default async function NewInvoicePage({ searchParams }: PageProps) {
  const activeCompany = await requireHubAccess()
  const params = await searchParams
  const customerId = params.customerId?.trim() ?? ''
  const { month } = params
  const selectedMonth = normalizeMonthValue(month)
  if (params.customerId != null && !customerId) {
    const cleanParams = new URLSearchParams()

    if (month) {
      cleanParams.set('month', selectedMonth)
    }

    const query = cleanParams.toString()
    redirect(query ? `/invoices/new?${query}` : '/invoices/new')
  }
  const previousMonth = getPreviousMonthValue(selectedMonth)
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

  const customerRows = (customersResponse.data ?? []) as CustomerRow[]
  const customerById = new Map(customerRows.map((customer) => [customer.id, customer]))
  const selectedCustomer = customerId ? customerById.get(customerId) ?? null : null
  let allInvoiceReadyJobs: InvoiceReadyJob[] = []
  let unavailableMessage: string | null = null

  const [jobsResponse, statesResponse, activeLinksResponse] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, customer_id, title, description, price, start_at, end_at, status')
      .eq('company_id', activeCompany.companyId)
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

    allInvoiceReadyJobs = ((jobsResponse.data ?? []) as JobRow[])
      .filter((job) => Boolean(job.customer_id))
      .filter((job) => (stateByJobId.get(job.id) === 'done' || job.status === 'done') && !invoicedJobIds.has(job.id))
      .filter((job) => Number(job.price ?? 0) > 0)
      .map((job) => ({
        ...job,
        calculatedTotal: calculateInvoiceItem(job.price, defaultVatRate).totalWithVat,
      }))
  }

  const invoiceReadyJobs = allInvoiceReadyJobs.filter((job) => isJobInMonth(job, selectedMonth))
  const previousMonthReadyJobs = allInvoiceReadyJobs.filter((job) => isJobInMonth(job, previousMonth))
  const availableJobs = customerId
    ? invoiceReadyJobs.filter((job) => job.customer_id === customerId)
    : []
  const customerJobGroups = buildCustomerJobGroups(invoiceReadyJobs, customerById, defaultVatRate)
  const previousMonthJobGroups = buildCustomerJobGroups(previousMonthReadyJobs, customerById, defaultVatRate)
  const selectedMonthTotals = sumInvoiceTotals(invoiceReadyJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate)))
  const previousMonthTotals = sumInvoiceTotals(previousMonthReadyJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate)))
  const totals = sumInvoiceTotals(
    availableJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate))
  )
  const today = new Date()
  const dueDate = addDaysToDate(today, DEFAULT_INVOICE_DUE_DAYS)

  return (
    <DashboardShell activeItem="invoices">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>Fakturace</p>
            <h1 style={titleStyle}>Nová faktura</h1>
            <p style={subtitleStyle}>
              Vyberte zákazníka a měsíc. Do návrhu faktury nabídneme hotové nevyfakturované zakázky a ceny se při vytvoření znovu ověří na serveru.
            </p>
          </div>
          <Link href="/invoices" style={backLinkStyle}>
            ← Zpět na fakturaci
          </Link>
        </header>

        {previousMonthReadyJobs.length > 0 ? (
          <section
            style={{
              ...panelStyle,
              padding: '18px',
              display: 'grid',
              gap: '14px',
              borderColor: 'rgba(245, 158, 11, 0.34)',
              background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 72%)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <p style={{ ...eyebrowStyle, marginBottom: '6px', color: '#b45309' }}>Pozor na minulý měsíc</p>
                <h2 style={sectionTitleStyle}>Nevyfakturované zakázky za {formatMonthLabel(previousMonth)}</h2>
                <p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.5, fontWeight: 650 }}>
                  Tyto hotové zakázky už měly být ve fakturaci. Doporučuji je uzavřít dřív, než začnete fakturovat aktuální měsíc.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '2px',
                  minWidth: '190px',
                  padding: '12px 14px',
                  borderRadius: '16px',
                  border: '1px solid rgba(245, 158, 11, 0.28)',
                  backgroundColor: '#ffffff',
                }}
              >
                <span style={{ color: '#92400e', fontSize: '13px', fontWeight: 850 }}>
                  {previousMonthReadyJobs.length} zakázek u {previousMonthJobGroups.length} zákazníků
                </span>
                <strong style={{ color: '#0f172a', fontSize: '22px' }}>
                  {formatCurrency(previousMonthTotals.totalWithVat)}
                </strong>
              </div>
            </div>

            <div className="invoice-ready-overview">
              {previousMonthJobGroups.slice(0, 3).map((group) => (
                <article key={group.customerId} className="invoice-ready-customer invoice-ready-customer-warning">
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div>
                        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '17px', fontWeight: 900 }}>
                          {group.customerName}
                        </h3>
                        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px', fontWeight: 750 }}>
                          {group.jobs.length} zakázek z minulého měsíce
                        </p>
                      </div>
                      <strong style={{ color: '#0f172a', fontSize: '17px' }}>
                        {formatCurrency(group.totals.totalWithVat)}
                      </strong>
                    </div>
                    <div className="invoice-ready-job-list">
                      {group.jobs.slice(0, 2).map((job) => (
                        <div key={job.id} className="invoice-ready-job">
                          <span>{job.title ?? 'Zakázka bez názvu'}</span>
                          <strong>{formatCurrency(job.calculatedTotal)}</strong>
                        </div>
                      ))}
                      {group.jobs.length > 2 ? (
                        <div className="invoice-ready-job invoice-ready-job-muted">
                          + {group.jobs.length - 2} další zakázky
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={`/invoices/new?customerId=${encodeURIComponent(group.customerId)}&month=${encodeURIComponent(previousMonth)}`}
                    className="invoice-ready-action invoice-ready-action-warning"
                  >
                    Fakturovat minulý měsíc
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <InvoiceOverviewFilterForm
          className="invoice-create-filter"
          style={{
            ...panelStyle,
            padding: '18px',
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '16px',
            alignItems: 'end',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h2 style={sectionTitleStyle}>1. Vyberte zákazníka</h2>
              <p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.5, fontWeight: 650 }}>
                Faktura se vždy vystavuje pro jednoho zákazníka. Když zatím nevyberete žádného, níže uvidíte přehled všech hotových zakázek připravených k fakturaci.
              </p>
            </div>
            <div
              style={{
                padding: '10px 13px',
                borderRadius: '14px',
                backgroundColor: customerId ? '#ecfeff' : '#eff6ff',
                color: customerId ? '#0f766e' : '#1d4ed8',
                fontSize: '13px',
                fontWeight: 900,
              }}
            >
              {customerId
                ? 'Zákazník vybrán'
                : `${invoiceReadyJobs.length} zakázek u ${customerJobGroups.length} zákazníků k fakturaci`}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) minmax(180px, 240px) auto',
              gap: '14px',
              alignItems: 'end',
            }}
          >
            <label>
              <span>Zákazník</span>
              <select
                name="customerId"
                defaultValue={customerId}
              >
                <option value="">Vyberte zákazníka</option>
                {customerRows.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name ?? 'Zákazník bez názvu'}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Měsíc dokončení</span>
              <input
                type="month"
                name="month"
                defaultValue={selectedMonth}
              />
            </label>

            <button
              type="submit"
              style={{
                minHeight: '46px',
                borderRadius: '12px',
                border: '1px solid rgba(148, 163, 184, 0.38)',
                backgroundColor: '#ffffff',
                padding: '0 16px',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Zobrazit přehled
            </button>
          </div>
        </InvoiceOverviewFilterForm>

        {customersResponse.error ? (
          <div style={{ ...alertStyle, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b' }}>
            {customersResponse.error.message}
          </div>
        ) : null}

        {unavailableMessage ? (
          <div style={{ ...alertStyle, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b' }}>
            {unavailableMessage}
          </div>
        ) : null}

        {customerId && !selectedCustomer ? (
          <div style={{ ...alertStyle, border: '1px solid #fde68a', backgroundColor: '#fefce8', color: '#854d0e' }}>
            Vybraný zákazník nebyl nalezen v aktivní firmě. Vyberte prosím zákazníka ze seznamu.
          </div>
        ) : null}

        {!customerId ? (
          <section
            style={{
              ...panelStyle,
              padding: '18px',
              display: 'grid',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <h2 style={sectionTitleStyle}>Hotové zakázky k fakturaci</h2>
                <p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.5, fontWeight: 650 }}>
                  Přehled ukazuje zakázky za vybraný měsíc, které jsou hotové, mají cenu a ještě nejsou na aktivní faktuře.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '2px',
                  minWidth: '180px',
                  padding: '12px 14px',
                  borderRadius: '16px',
                  border: '1px solid rgba(148, 163, 184, 0.24)',
                  backgroundColor: '#f8fafc',
                }}
              >
                <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 800 }}>Celkem k fakturaci</span>
                <strong style={{ color: '#0f172a', fontSize: '22px' }}>
                  {formatCurrency(selectedMonthTotals.totalWithVat)}
                </strong>
                <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 750 }}>
                  {invoiceReadyJobs.length} zakázek u {customerJobGroups.length} zákazníků
                </span>
              </div>
            </div>

            {customerJobGroups.length === 0 ? (
              <div
                style={{
                  border: '1px dashed rgba(148, 163, 184, 0.55)',
                  borderRadius: '18px',
                  padding: '18px',
                  color: '#64748b',
                  fontWeight: 700,
                  backgroundColor: '#f8fafc',
                }}
              >
                V tomto měsíci nejsou žádné hotové nevyfakturované zakázky s vyplněnou cenou.
              </div>
            ) : (
              <div className="invoice-ready-overview">
                {customerJobGroups.map((group) => (
                  <article key={group.customerId} className="invoice-ready-customer">
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '12px',
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div>
                          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px', fontWeight: 900 }}>
                            {group.customerName}
                          </h3>
                          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px', fontWeight: 750 }}>
                            {group.jobs.length} zakázek připravených k fakturaci
                          </p>
                        </div>
                        <strong style={{ color: '#0f172a', fontSize: '18px' }}>
                          {formatCurrency(group.totals.totalWithVat)}
                        </strong>
                      </div>
                      <div className="invoice-ready-job-list">
                        {group.jobs.slice(0, 3).map((job) => (
                          <div key={job.id} className="invoice-ready-job">
                            <span>{job.title ?? 'Zakázka bez názvu'}</span>
                            <strong>{formatCurrency(job.calculatedTotal)}</strong>
                          </div>
                        ))}
                        {group.jobs.length > 3 ? (
                          <div className="invoice-ready-job invoice-ready-job-muted">
                            + {group.jobs.length - 3} další zakázky
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={`/invoices/new?customerId=${encodeURIComponent(group.customerId)}&month=${encodeURIComponent(selectedMonth)}`}
                      className="invoice-ready-action"
                    >
                      Fakturovat zákazníka
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {customerId && selectedCustomer ? (
          <form action={createInvoiceFromJobs} className="invoice-create-form" style={{ display: 'grid', gap: '16px' }}>
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="month" value={selectedMonth} />

            <section
              style={{
                ...panelStyle,
                padding: '18px',
                display: 'grid',
                gap: '16px',
              }}
            >
              <h2 style={sectionTitleStyle}>Doklad</h2>
              {!isVatPayer ? (
                <div
                  style={{
                    border: '1px solid #fde68a',
                    backgroundColor: '#fef9c3',
                    color: '#854d0e',
                    borderRadius: '14px',
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
                <label>
                  <span>Datum vystavení</span>
                  <input
                    type="date"
                    name="issueDate"
                    defaultValue={toDateInputValue(today)}
                  />
                </label>
                <label>
                  <span>DUZP</span>
                  <input
                    type="date"
                    name="taxableSupplyDate"
                    defaultValue={toDateInputValue(today)}
                  />
                </label>
                <label>
                  <span>Splatnost</span>
                  <input
                    type="date"
                    name="dueDate"
                    defaultValue={toDateInputValue(dueDate)}
                  />
                </label>
                <label>
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
                      backgroundColor: isVatPayer ? '#ffffff' : '#f3f4f6',
                    }}
                  />
                </label>
              </div>
              <label>
                <span>Poznámka</span>
                <textarea
                  name="note"
                  rows={3}
                />
              </label>
            </section>

            <section
              style={{
                ...panelStyle,
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
                ...panelStyle,
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
                  borderRadius: '14px',
                  border: 'none',
                  backgroundColor: availableJobs.length === 0 ? '#9ca3af' : '#111827',
                  color: '#ffffff',
                  minHeight: '50px',
                  padding: '12px 18px',
                  fontWeight: 900,
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
