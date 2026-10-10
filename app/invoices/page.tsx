import Link from 'next/link'

import styles from '@/components/OperationalUI.module.css'
import { primaryButtonStyle, secondaryButtonStyle } from '@/components/SaasPageLayout'

import DashboardShell from '@/components/DashboardShell'
import {
  formatCurrency,
  formatInvoiceStatus,
  formatPohodaExportStatus,
} from '@/lib/invoices'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  searchParams: Promise<{
    status?: string
    export?: string
    month?: string
  }>
}

type InvoiceRow = {
  id: string
  customer_id: string
  invoice_number: string | null
  variable_symbol: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  total_with_vat: number | null
  pohoda_export_status: string | null
  pohoda_exported_at: string | null
  pohoda_last_error: string | null
  customers?:
    | {
        name: string | null
      }[]
    | {
        name: string | null
      }
    | null
}

function normalizeCustomerRelation(value: InvoiceRow['customers']) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

function normalizeMonthValue(value: string | undefined) {
  if (!value) return getCurrentMonthValue()
  if (!/^\d{4}-\d{2}$/.test(value)) return getCurrentMonthValue()
  return value
}

function getMonthDateRange(monthValue: string) {
  const [yearText, monthText] = monthValue.split('-')
  const year = Number.parseInt(yearText, 10)
  const monthIndex = Number.parseInt(monthText, 10) - 1

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const fallback = getCurrentMonthValue()
    return getMonthDateRange(fallback)
  }

  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function badgeStyle(kind: 'neutral' | 'success' | 'warning' | 'danger') {
  const palette = {
    neutral: ['#f3f4f6', '#374151', '#d1d5db'],
    success: ['#dcfce7', '#166534', '#bbf7d0'],
    warning: ['#fef9c3', '#854d0e', '#fde68a'],
    danger: ['#fee2e2', '#991b1b', '#fecaca'],
  }[kind]

  return {
    display: 'inline-block',
    borderRadius: '999px',
    backgroundColor: palette[0],
    color: palette[1],
    border: `1px solid ${palette[2]}`,
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 800,
    whiteSpace: 'nowrap' as const,
  }
}

function invoiceStatusKind(status: string | null | undefined) {
  if (status === 'paid') return 'success'
  if (status === 'overdue' || status === 'cancelled') return 'danger'
  if (status === 'draft') return 'warning'
  return 'neutral'
}

function exportStatusKind(status: string | null | undefined) {
  if (status === 'exported') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const activeCompany = await requireHubAccess()
  const {
    status = 'all',
    export: exportStatus = 'all',
    month: rawMonth,
  } = await searchParams
  const supabase = await createSupabaseServerClient()
  const selectedMonth = normalizeMonthValue(rawMonth)
  const monthRange = getMonthDateRange(selectedMonth)

  let query = supabase
    .from('invoices')
    .select(
      'id, customer_id, invoice_number, variable_symbol, status, issue_date, due_date, total_with_vat, pohoda_export_status, pohoda_exported_at, pohoda_last_error, customers(name)'
    )
    .eq('company_id', activeCompany.companyId)
    .gte('issue_date', monthRange.start)
    .lt('issue_date', monthRange.end)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  if (exportStatus !== 'all') {
    query = query.eq('pohoda_export_status', exportStatus)
  }

  const { data, error } = await query
  const invoices = ((data ?? []) as InvoiceRow[]).map((invoice) => ({
    ...invoice,
    customer: normalizeCustomerRelation(invoice.customers),
  }))
  const paidInvoicesCount = invoices.filter((invoice) => invoice.status === 'paid').length
  const waitingInvoicesCount = invoices.filter((invoice) =>
    ['draft', 'issued', 'sent', null, undefined].includes(invoice.status)
  ).length
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + (invoice.total_with_vat ?? 0), 0)

  if (error) {
    console.error('Invoices page load failed', error)
  }

  return (
    <DashboardShell activeItem="invoices">
      <main className={styles.page}>
        <header data-tour="invoices-header" className={styles.header}>
          <div>
            <h1 className={styles.title}>Fakturace</h1>
            <p className={styles.subtitle}>Faktury, jejich splatnost a úhrady na jednom místě.</p>
          </div>
          <Link href="/invoices/new" data-tour="new-invoice-button" style={primaryButtonStyle}>+ Nová faktura</Link>
        </header>

        <form method="get" data-tour="invoices-filters" className={styles.filterPanel}>
          <div className={styles.filterRow}>
            <label className={styles.field}>
              <span>Měsíc vystavení</span>
              <input type="month" name="month" defaultValue={selectedMonth} className={styles.input} />
            </label>
            <label className={styles.field}>
              <span>Stav faktury</span>
              <select name="status" defaultValue={status} className={styles.input}>
                <option value="all">Všechny faktury</option>
                <option value="draft">Koncept</option><option value="issued">Vystavená</option>
                <option value="sent">Odeslaná</option><option value="paid">Zaplacená</option>
                <option value="overdue">Po splatnosti</option><option value="cancelled">Zrušená</option>
              </select>
            </label>
            <button type="submit" style={secondaryButtonStyle}>Zobrazit</button>
          </div>
          <details className={styles.disclosure} open={exportStatus !== 'all'}>
            <summary>Export do Pohody{exportStatus !== 'all' ? ' · aktivní filtr' : ''}</summary>
            <div className={styles.disclosureContent}>
              <label className={styles.field}>
                <span>Stav exportu</span>
                <select name="export" defaultValue={exportStatus} className={styles.input}>
                  <option value="all">Vše</option><option value="not_exported">Neexportováno</option>
                  <option value="exported">Exportováno</option><option value="failed">Chyba</option>
                </select>
              </label>
            </div>
          </details>
        </form>

        {error ? (
          <div className={styles.empty} role="alert"><h2>Faktury se nepodařilo načíst.</h2><p>Obnovte stránku a zkuste to znovu.</p></div>
        ) : invoices.length === 0 ? (
          <div data-tour="invoices-list" className={styles.empty}>
            <span className={styles.avatar} aria-hidden="true">+</span>
            <h2>Žádné faktury v tomto výběru</h2>
            <p>Změňte měsíc nebo stav. Novou fakturu vytvoříte z hotových zakázek zákazníka.</p>
            <Link href="/invoices/new" style={primaryButtonStyle}>Vytvořit fakturu</Link>
          </div>
        ) : (
          <section data-tour="invoices-list" className={styles.list}>
            <span className={styles.count}>Počet faktur: {invoices.length}</span>
            <div className={`${styles.tableWrap} ${styles.desktopInvoices}`}>
              <table className={styles.table}>
                <thead><tr>
                  <th scope="col">Faktura / zákazník</th><th scope="col">Vystavení</th><th scope="col">Splatnost</th>
                  <th scope="col">Stav</th><th scope="col">Pohoda</th><th scope="col" className={styles.amount}>Celkem</th>
                </tr></thead>
                <tbody>{invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link href={`/invoices/${invoice.id}`}>{invoice.invoice_number ?? 'Koncept'}</Link>
                      <div className={styles.meta} style={{ marginTop: 0 }}>{invoice.customer?.name ?? 'Bez zákazníka'}</div>
                      {invoice.variable_symbol ? <div className={styles.meta}>VS {invoice.variable_symbol}</div> : null}
                    </td>
                    <td>{formatDate(invoice.issue_date)}</td><td>{formatDate(invoice.due_date)}</td>
                    <td><span style={badgeStyle(invoiceStatusKind(invoice.status))}>{formatInvoiceStatus(invoice.status)}</span></td>
                    <td>
                      <span style={badgeStyle(exportStatusKind(invoice.pohoda_export_status))}>{formatPohodaExportStatus(invoice.pohoda_export_status)}</span>
                      {invoice.pohoda_last_error ? <p style={{ fontSize: 12, color: '#b04452' }}>Export se nepodařil. Podrobnosti ve faktuře.</p> : null}
                    </td>
                    <td className={styles.amount}>{formatCurrency(invoice.total_with_vat)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className={styles.mobileInvoices}>
              {invoices.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`} className={styles.invoiceCard}>
                  <div className={styles.invoiceCardTop}>
                    <strong>{invoice.invoice_number ?? 'Koncept'}</strong>
                    <span style={badgeStyle(invoiceStatusKind(invoice.status))}>{formatInvoiceStatus(invoice.status)}</span>
                  </div>
                  <div className={styles.resourceTitle}>{invoice.customer?.name ?? 'Bez zákazníka'}</div>
                  <div className={styles.meta}>
                    <span>Vystaveno {formatDate(invoice.issue_date)}</span><span>Splatnost {formatDate(invoice.due_date)}</span>
                    {invoice.variable_symbol ? <span>VS {invoice.variable_symbol}</span> : null}
                    <span>Pohoda: {formatPohodaExportStatus(invoice.pohoda_export_status)}</span>
                  </div>
                  <div className={styles.invoiceCardTop}><strong>{formatCurrency(invoice.total_with_vat)}</strong><span aria-hidden="true">→</span></div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </DashboardShell>
  )
}
