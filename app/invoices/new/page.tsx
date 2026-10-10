import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'

import styles from '@/components/OperationalUI.module.css'
import { heroCardStyle as headerStyle, heroTitleStyle as titleStyle, heroTextStyle as subtitleStyle, eyebrowStyle, secondaryButtonStyle as backLinkStyle, primaryButtonStyle } from '@/components/SaasPageLayout'

import DashboardShell from '@/components/DashboardShell'
import InvoiceCreateForm, { InvoiceCreateItemTotal } from './InvoiceCreateForm'
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
import { ModuleAccessError, requirePaidCompanyCapability } from '@/lib/platform/module-operation-access'

type PageProps = {
  searchParams: Promise<{
    customerId?: string
    jobId?: string
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
  currency: string | null
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

export default async function NewInvoicePage({ searchParams }: PageProps) {
  const activeCompany = await requireHubAccess()
  const params = await searchParams
  const customerId = params.customerId?.trim() ?? ''
  const { month } = params
  let selectedMonth = normalizeMonthValue(month)
  if (params.customerId != null && !customerId) {
    const cleanParams = new URLSearchParams()

    if (month) {
      cleanParams.set('month', selectedMonth)
    }

    const query = cleanParams.toString()
    redirect(query ? `/invoices/new?${query}` : '/invoices/new')
  }
  const supabase = await createSupabaseServerClient()
  try {
    await requirePaidCompanyCapability({ companyId: activeCompany.companyId, supabase }, 'invoicing.invoice.issue')
  } catch (error) {
    if (!(error instanceof ModuleAccessError)) throw error
    return (
      <DashboardShell activeItem="invoices">
        <main style={pageStyle}>
          <h1 style={titleStyle}>Nová faktura</h1>
          <p role="alert" style={alertStyle}>{error.message}</p>
          <p><Link href="/billing/modules">Přehled placených modulů</Link></p>
          <Link href="/invoices">Zpět na faktury</Link>
        </main>
      </DashboardShell>
    )
  }

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
  let unavailableMessage: string | null = companyResponse.error || !companyResponse.data
    ? 'Údaje dodavatele se nepodařilo načíst. Obnovte stránku před vytvořením faktury.'
    : null

  const [jobsResponse, statesResponse, activeLinksResponse] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, customer_id, title, description, price, currency, start_at, end_at, status')
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

  if (jobsResponse.error || statesResponse.error || activeLinksResponse.error) {
    unavailableMessage ??= 'Zakázky připravené k fakturaci se nepodařilo načíst. Obnovte stránku.'
  }
  if (!unavailableMessage) {
    const stateByJobId = new Map(
      ((statesResponse.data ?? []) as JobStateRow[]).map((state) => [state.id, state.work_state])
    )
    const invoicedJobIds = new Set(
      ((activeLinksResponse.data ?? []) as Array<{ job_id: string }>).map((item) => item.job_id)
    )

    allInvoiceReadyJobs = ((jobsResponse.data ?? []) as JobRow[])
      .filter((job) => Boolean(job.customer_id))
      .filter((job) => (stateByJobId.get(job.id) === 'done' || job.status === 'done') && !invoicedJobIds.has(job.id))
      .filter((job) => job.currency === 'CZK' && Number.isFinite(Number(job.price)) && Number(job.price ?? 0) > 0)
      .map((job) => ({
        ...job,
        calculatedTotal: calculateInvoiceItem(job.price, defaultVatRate).totalWithVat,
      }))
  }

  // A job-detail link starts in that job's completion month unless the user
  // explicitly chose a month. Only trust rows already loaded for this company.
  const requestedJobId = typeof params.jobId === 'string' ? params.jobId.trim() : ''
  if (month == null && requestedJobId && customerId && !jobsResponse.error) {
    const linkedJob = ((jobsResponse.data ?? []) as JobRow[]).find(
      (job) => job.id === requestedJobId && job.customer_id === customerId
    )
    const relevantDate = linkedJob?.end_at ?? linkedJob?.start_at
    const parsedDate = relevantDate ? new Date(relevantDate) : null
    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
      selectedMonth = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`
    }
  }
  const previousMonth = getPreviousMonthValue(selectedMonth)
  const invoiceReadyJobs = allInvoiceReadyJobs.filter((job) => isJobInMonth(job, selectedMonth))
  const previousMonthReadyJobs = allInvoiceReadyJobs.filter((job) => isJobInMonth(job, previousMonth))
  const availableJobs = customerId
    ? invoiceReadyJobs.filter((job) => job.customer_id === customerId)
    : []
  const preselectedJobId = availableJobs.some((job) => job.id === requestedJobId) ? requestedJobId : null
  const customerJobGroups = buildCustomerJobGroups(invoiceReadyJobs, customerById, defaultVatRate)
  const previousMonthJobGroups = buildCustomerJobGroups(previousMonthReadyJobs, customerById, defaultVatRate)
  const selectedMonthTotals = sumInvoiceTotals(invoiceReadyJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate)))
  const previousMonthTotals = sumInvoiceTotals(previousMonthReadyJobs.map((job) => calculateInvoiceItem(job.price, defaultVatRate)))
  const today = new Date()
  const dueDate = addDaysToDate(today, DEFAULT_INVOICE_DUE_DAYS)
  const requestId = randomUUID()

  return (
    <DashboardShell activeItem="invoices">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>Fakturace</p>
            <h1 style={titleStyle}>Nová faktura</h1>
            <p style={subtitleStyle}>
              Vyberte zákazníka, zkontrolujte zakázky a uložte koncept faktury.
            </p>
          </div>
          <Link href="/invoices" style={backLinkStyle}>
            ← Zpět na fakturaci
          </Link>
        </header>

        <ol className={styles.steps} aria-label="Postup vytvoření faktury">
          <li aria-current={!customerId ? 'step' : undefined}><span>1</span> Zákazník</li>
          <li aria-current={customerId ? 'step' : undefined}><span>2</span> Kontrola údajů</li>
          <li><span>3</span> Uložení konceptu</li>
        </ol>

        {previousMonthReadyJobs.length > 0 ? (
          <details
            style={{
              ...panelStyle,
              padding: '18px',
              display: 'grid',
              gap: '14px',
              borderColor: 'rgba(245, 158, 11, 0.34)',
              background: '#fffdf8',
            }}
          >
            <summary style={{ minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              Nefakturované zakázky z minulého měsíce · {previousMonthReadyJobs.length}
            </summary>
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
                <article key={group.customerId} className={styles.invoiceReadyCustomer}>
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
                    style={primaryButtonStyle}
                  >
                    Fakturovat minulý měsíc
                  </Link>
                </article>
              ))}
            </div>
          </details>
        ) : null}

        <InvoiceOverviewFilterForm
          className={styles.form}
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
                Vyberte jednoho zákazníka a měsíc dokončení zakázek.
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

<div className={styles.filterRow}>
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
            Zákazníky se nepodařilo načíst. Obnovte stránku.
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

        {requestedJobId && !preselectedJobId && !unavailableMessage ? (
          <div role="status" style={{ ...alertStyle, border: '1px solid #fde68a', backgroundColor: '#fefce8', color: '#854d0e' }}>
            Zvolená zakázka není v tomto výběru dostupná k fakturaci. Můžete upravit období nebo vybrat jiné zakázky.
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
                  Hotové zakázky s vyplněnou cenou, které ještě nejsou na faktuře.
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
                  <article key={group.customerId} className={styles.invoiceReadyCustomer}>
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
                      style={primaryButtonStyle}
                    >
                      Fakturovat zákazníka
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {customerId && selectedCustomer && !unavailableMessage ? (
          <InvoiceCreateForm
            key={`${activeCompany.companyId}:${customerId}:${selectedMonth}:${requestedJobId || 'all'}:${preselectedJobId ? 'selected' : 'unselected'}`}
            companyId={activeCompany.companyId}
            requestId={requestId}
            availableJobs={availableJobs.map((job) => ({ id: job.id, price: Number(job.price ?? 0) }))}
            initialSelectedJobIds={requestedJobId ? (preselectedJobId ? [preselectedJobId] : []) : undefined}
            isVatPayer={isVatPayer}
            defaultVatRate={defaultVatRate}
          >
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
              <h2 style={sectionTitleStyle}>2. Zkontrolujte údaje faktury</h2>
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
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                    defaultValue={toDateInputValue(today)}
                  />
                </label>
                <label>
                  <span>DUZP</span>
                  <input
                    type="date"
                    name="taxableSupplyDate"
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                    defaultValue={toDateInputValue(today)}
                  />
                </label>
                <label>
                  <span>Splatnost</span>
                  <input
                    type="date"
                    name="dueDate"
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                    defaultValue={toDateInputValue(dueDate)}
                  />
                </label>
                <label>
                  <span>Sazba DPH (%)</span>
                  <input
                    type="number"
                    name="vatRate"
                    required={isVatPayer}
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
                  maxLength={10000}
                  rows={3}
                />
              </label>
            </section>

            <section style={{ ...panelStyle, padding: 18, display: 'grid', gap: 16 }}>
              <div>
                <h2 style={sectionTitleStyle}>Zakázky na faktuře</h2>
                <p className={styles.formHint}>Ponechte zaškrtnuté zakázky, které chcete fakturovat.</p>
              </div>
              {availableJobs.length === 0 ? (
                <div className={styles.empty}>Pro zákazníka nejsou hotové nevyfakturované zakázky s vyplněnou cenou.</div>
              ) : (
                <div className={styles.list}>
                  {availableJobs.map((job) => (
                    <label key={job.id} className={styles.invoiceJob}>
                      <input type="checkbox" name="jobIds" value={job.id} aria-label={`Fakturovat zakázku ${job.title ?? job.id}`} defaultChecked={!requestedJobId || job.id === preselectedJobId} />
                      <span className={styles.resourceBody}>
                        <strong className={styles.resourceTitle}>{job.title ?? 'Zakázka bez názvu'}</strong>
                        <span className={styles.meta}>{formatDate(job.start_at)} – {formatDate(job.end_at)}</span>
                        {job.description ? <span className={styles.meta}>{job.description}</span> : null}
                        <span className={styles.meta}>Bez DPH {formatCurrency(job.price)}</span>
                      </span>
                      <span className={styles.invoiceJobTotal}>
                        <strong><InvoiceCreateItemTotal price={Number(job.price ?? 0)} /></strong>
                        <span>včetně DPH</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

          </InvoiceCreateForm>
        ) : null}
      </main>
    </DashboardShell>
  )
}
