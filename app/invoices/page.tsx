import Link from 'next/link'

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
      <main style={{ display: 'grid', gap: '12px', color: '#111827' }}>
        <header
          data-tour="invoices-header"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.15fr) minmax(260px, 0.85fr)',
            gap: '14px',
            alignItems: 'stretch',
            overflow: 'hidden',
            borderRadius: '20px',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            background:
              'radial-gradient(circle at 8% 8%, rgba(124, 58, 237, 0.16), transparent 30%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.16), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(239,246,255,0.9) 55%, rgba(240,253,250,0.88))',
            padding: '18px 20px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
          }}
        >
          <div>
            <div
              style={{
                display: 'inline-flex',
                borderRadius: '999px',
                padding: '4px 9px',
                marginBottom: '8px',
                background: 'rgba(37, 99, 235, 0.1)',
                border: '1px solid rgba(37, 99, 235, 0.18)',
                color: '#1d4ed8',
                fontSize: '11px',
                fontWeight: 850,
              }}
            >
              Finance
            </div>
            <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 1.08, color: '#020617' }}>
              Fakturace
            </h1>
            <p style={{ margin: '7px 0 0', color: '#475569', lineHeight: 1.45, fontSize: '14px', maxWidth: '620px' }}>
              Přehled interních faktur, stavů a exportu do Pohody.
            </p>
          </div>

          <Link
            href="/invoices/new"
            data-tour="new-invoice-button"
            style={{
              alignSelf: 'start',
              borderRadius: '999px',
              background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
              color: '#ffffff',
              minHeight: '36px',
              padding: '8px 12px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 850,
              boxShadow: '0 10px 22px rgba(37, 99, 235, 0.16)',
            }}
          >
            Vytvořit fakturu
          </Link>
        </header>

        <form
          method="get"
          data-tour="invoices-filters"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto',
            gap: '12px',
            alignItems: 'end',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: '24px',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '18px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
            <span>Měsíc</span>
            <input
              type="month"
              name="month"
              defaultValue={selectedMonth}
              style={{
                height: '42px',
                borderRadius: '14px',
                border: '1px solid #d1d5db',
                padding: '0 12px',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
            <span>Stav</span>
            <select
              name="status"
              defaultValue={status}
              style={{ height: '42px', borderRadius: '14px', border: '1px solid #d1d5db', padding: '0 12px' }}
            >
              <option value="all">Vše</option>
              <option value="draft">Koncept</option>
              <option value="issued">Vystavená</option>
              <option value="sent">Odeslaná</option>
              <option value="paid">Zaplacená</option>
              <option value="overdue">Po splatnosti</option>
              <option value="cancelled">Zrušená</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
            <span>Export Pohoda</span>
            <select
              name="export"
              defaultValue={exportStatus}
              style={{ height: '42px', borderRadius: '14px', border: '1px solid #d1d5db', padding: '0 12px' }}
            >
              <option value="all">Vše</option>
              <option value="not_exported">Neexportováno</option>
              <option value="exported">Exportováno</option>
              <option value="failed">Chyba</option>
            </select>
          </label>

          <button
            type="submit"
            style={{
              height: '42px',
              borderRadius: '999px',
              border: '1px solid rgba(37, 99, 235, 0.22)',
              background: 'rgba(37, 99, 235, 0.08)',
              color: '#1d4ed8',
              padding: '0 16px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Filtrovat
          </button>
        </form>

        {error ? (
          <div
            style={{
              border: '1px solid rgba(248, 113, 113, 0.35)',
              background: 'rgba(254, 242, 242, 0.9)',
              color: '#991b1b',
              borderRadius: '20px',
              padding: '16px',
              fontWeight: 700,
            }}
          >
            Data se nepodařilo načíst.
            <div style={{ marginTop: '5px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
              Technický detail je v konzoli.
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: '12px' }}>
          <section
            data-tour="invoices-list"
            style={{
              border: '1px solid rgba(148, 163, 184, 0.22)',
              borderRadius: '24px',
              background: 'rgba(255, 255, 255, 0.92)',
              overflowX: 'auto',
              boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', textAlign: 'left' }}>
                  <th style={{ padding: '12px' }}>Číslo</th>
                  <th style={{ padding: '12px' }}>Zákazník</th>
                  <th style={{ padding: '12px' }}>Vystavení</th>
                  <th style={{ padding: '12px' }}>Splatnost</th>
                  <th style={{ padding: '12px' }}>Stav</th>
                  <th style={{ padding: '12px' }}>Pohoda</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Celkem</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '18px', color: '#6b7280' }}>
                      Zatím nejsou vytvořené žádné faktury.
                    </td>
                  </tr>
                ) : (
                  invoices.map((invoice) => {
                    return (
                      <tr key={invoice.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px', fontWeight: 800 }}>
                          <Link href={`/invoices/${invoice.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                            {invoice.invoice_number ?? 'Koncept'}
                          </Link>
                          {invoice.variable_symbol ? (
                            <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px' }}>
                              VS {invoice.variable_symbol}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '12px' }}>{invoice.customer?.name ?? '-'}</td>
                        <td style={{ padding: '12px' }}>{formatDate(invoice.issue_date)}</td>
                        <td style={{ padding: '12px' }}>{formatDate(invoice.due_date)}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={badgeStyle(invoiceStatusKind(invoice.status))}>
                            {formatInvoiceStatus(invoice.status)}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={badgeStyle(exportStatusKind(invoice.pohoda_export_status))}>
                            {formatPohodaExportStatus(invoice.pohoda_export_status)}
                          </span>
                          {invoice.pohoda_last_error ? (
                            <div style={{ color: '#991b1b', fontSize: '12px', marginTop: '4px' }}>
                              {invoice.pohoda_last_error}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                          {formatCurrency(invoice.total_with_vat)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </DashboardShell>
  )
}
