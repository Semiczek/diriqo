import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  cancelInvoice,
  deleteInvoicePermanently,
  exportInvoicesToPohoda,
  issueInvoice,
  markInvoicePaid,
  markInvoiceSent,
  refreshDraftInvoiceSupplierSnapshot,
  sendInvoiceByEmail,
  updateDraftInvoice,
} from '@/app/invoices/actions'
import DashboardShell from '@/components/DashboardShell'
import {
  buildQrPaymentPayload,
  formatCurrency,
  formatInvoiceStatus,
  formatPohodaExportStatus,
} from '@/lib/invoices'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    invoiceId: string
  }>
  searchParams?: Promise<{
    mail?: string
    mailError?: string
  }>
}

type Snapshot = Record<string, unknown>

type InvoiceRow = {
  id: string
  customer_id: string
  invoice_number: string | null
  variable_symbol: string | null
  status: string | null
  currency: string | null
  issue_date: string | null
  taxable_supply_date: string | null
  due_date: string | null
  payment_method: string | null
  is_vat_payer: boolean | null
  vat_note: string | null
  subtotal_without_vat: number | null
  vat_total: number | null
  total_with_vat: number | null
  customer_snapshot: Snapshot
  supplier_snapshot: Snapshot
  note: string | null
  issued_at: string | null
  sent_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  pohoda_export_status: string | null
  pohoda_exported_at: string | null
  pohoda_last_error: string | null
  pohoda_last_export_id: string | null
}

type InvoiceItemRow = {
  id: string
  source_job_id: string | null
  item_name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price_without_vat: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_without_vat: number | null
  total_with_vat: number | null
}

function getSnapshotString(snapshot: Snapshot, key: string) {
  const value = snapshot?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function toInputDate(value: string | null | undefined) {
  if (!value) return ''
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? ''
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('cs-CZ')
}

function getDefaultInvoiceMailSubject(invoiceNumber: string | null | undefined) {
  return `Faktura ${invoiceNumber?.trim() || ''}`.trim()
}

function getDefaultInvoiceMailMessage(invoice: InvoiceRow, supplierName: string | null) {
  return [
    'Dobrý den,',
    '',
    `v příloze zasíláme fakturu ${invoice.invoice_number ?? ''}.`,
    `Částka k úhradě: ${invoice.total_with_vat ?? 0} Kč`,
    `Datum splatnosti: ${invoice.due_date ?? '-'}`,
    '',
    'S pozdravem',
    supplierName || 'Diriqo',
  ].join('\n')
}

function getProfessionalInvoiceMailMessage(
  invoice: InvoiceRow,
  supplierName: string | null,
  senderCompanyName: string | null,
  senderProfileId: string,
  senderProfileName: string | null,
  senderProfileEmail: string | null,
) {
  const senderLabel =
    senderProfileName || senderProfileEmail || `ID ${senderProfileId}`

  return [
    'Dobrý den,',
    '',
    `v příloze Vám zasíláme fakturu ${invoice.invoice_number ?? ''}.`,
    `Částka k úhradě: ${invoice.total_with_vat ?? 0} Kč`,
    `Datum splatnosti: ${invoice.due_date ?? '-'}`,
    '',
    'V případě dotazů se na nás neváhejte obrátit.',
    '',
    'S pozdravem,',
    supplierName || 'Diriqo',
    `Společnost: ${senderCompanyName || supplierName || 'Diriqo'}`,
    `Odesílatel: ${senderLabel}`,
    `ID odesílatele: ${senderProfileId}`,
  ].join('\n')
}

function DetailBox({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '12px',
        backgroundColor: '#f9fafb',
        display: 'grid',
        gap: '4px',
      }}
    >
      <span style={{ color: '#6b7280', fontSize: '12px', fontWeight: 800 }}>{label}</span>
      <strong style={{ overflowWrap: 'anywhere' }}>{value || '-'}</strong>
    </div>
  )
}

function ActionButton({
  children,
  danger = false,
}: {
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="submit"
      style={{
        borderRadius: '8px',
        border: danger ? '1px solid #fecaca' : '1px solid #d1d5db',
        backgroundColor: danger ? '#fef2f2' : '#ffffff',
        color: danger ? '#991b1b' : '#111827',
        padding: '10px 14px',
        fontWeight: 800,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '40px',
  borderRadius: '8px',
  border: '1px solid #d1d5db',
  padding: '0 10px',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '6px',
  fontWeight: 800,
}

export default async function InvoiceDetailPage({ params, searchParams }: PageProps) {
  const activeCompany = await requireHubAccess()
  const { invoiceId } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const supabase = await createSupabaseServerClient()

  const [invoiceResponse, itemsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, customer_id, invoice_number, variable_symbol, status, currency, issue_date, taxable_supply_date, due_date, payment_method, is_vat_payer, vat_note, subtotal_without_vat, vat_total, total_with_vat, customer_snapshot, supplier_snapshot, note, issued_at, sent_at, paid_at, cancelled_at, pohoda_export_status, pohoda_exported_at, pohoda_last_error, pohoda_last_export_id'
      )
      .eq('id', invoiceId)
      .eq('company_id', activeCompany.companyId)
      .maybeSingle(),
    supabase
      .from('invoice_items')
      .select(
        'id, source_job_id, item_name, description, quantity, unit, unit_price_without_vat, vat_rate, vat_amount, total_without_vat, total_with_vat'
      )
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (invoiceResponse.error) {
    throw new Error(invoiceResponse.error.message)
  }

  if (!invoiceResponse.data) {
    notFound()
  }

  if (itemsResponse.error) {
    throw new Error(itemsResponse.error.message)
  }

  const invoice = invoiceResponse.data as InvoiceRow
  const items = (itemsResponse.data ?? []) as InvoiceItemRow[]
  const customer = invoice.customer_snapshot ?? {}
  const supplier = invoice.supplier_snapshot ?? {}
  const qrPaymentPayload = buildQrPaymentPayload({
    iban: getSnapshotString(supplier, 'iban'),
    bankAccountNumber: getSnapshotString(supplier, 'bankAccountNumber'),
    bankCode: getSnapshotString(supplier, 'bankCode'),
    amount: invoice.total_with_vat,
    variableSymbol: invoice.variable_symbol,
    invoiceNumber: invoice.invoice_number,
  })
  const canExport =
    Boolean(invoice.invoice_number) &&
    ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status ?? '')
  const customerEmail = getSnapshotString(customer, 'email')
  const canSendEmail = canExport && Boolean(customerEmail)
  const mailSuccess = resolvedSearchParams.mail === 'sent'
  const mailError = (resolvedSearchParams.mailError ?? '').trim()
  const supplierDisplayName =
    getSnapshotString(supplier, 'billingName') || getSnapshotString(supplier, 'name')
  const defaultMailSubject = getDefaultInvoiceMailSubject(invoice.invoice_number)
  const defaultMailMessage = getProfessionalInvoiceMailMessage(
    invoice,
    supplierDisplayName,
    activeCompany.companyName,
    activeCompany.profileId,
    activeCompany.profileName,
    activeCompany.profileEmail,
  )

  return (
    <DashboardShell activeItem="invoices">
      <main style={{ display: 'grid', gap: '20px', color: '#111827' }}>
        <div>
          <Link href="/invoices" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 800 }}>
            Zpět na fakturaci
          </Link>
          <h1 style={{ margin: '18px 0 8px 0', fontSize: '36px' }}>
            Faktura {invoice.invoice_number ?? 'koncept'}
          </h1>
          <p style={{ margin: 0, color: '#6b7280' }}>
            {formatInvoiceStatus(invoice.status)} | Pohoda: {formatPohodaExportStatus(invoice.pohoda_export_status)}
          </p>
        </div>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            padding: '16px',
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {invoice.status === 'draft' ? (
              <>
                <form action={refreshDraftInvoiceSupplierSnapshot}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <ActionButton>Načíst dodavatele z Můj účet</ActionButton>
                </form>
                <form action={issueInvoice}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <ActionButton>Vystavit fakturu</ActionButton>
                </form>
              </>
            ) : null}

            {['issued', 'sent'].includes(invoice.status ?? '') ? (
              <form action={markInvoiceSent}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <ActionButton>Označit jako odeslanou</ActionButton>
              </form>
            ) : null}

            {['issued', 'sent', 'overdue'].includes(invoice.status ?? '') ? (
              <form action={markInvoicePaid}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <ActionButton>Označit jako zaplacenou</ActionButton>
              </form>
            ) : null}

            {invoice.status !== 'cancelled' && invoice.status !== 'paid' ? (
              <form action={cancelInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <ActionButton danger>Zrušit fakturu</ActionButton>
              </form>
            ) : null}

            {invoice.pohoda_export_status !== 'exported' ? (
              <form action={deleteInvoicePermanently}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <ActionButton danger>Smazat natrvalo</ActionButton>
              </form>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <form action={sendInvoiceByEmail}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button
                type="submit"
                disabled={!canSendEmail}
                title={
                  canSendEmail
                    ? undefined
                    : customerEmail
                      ? 'E-mailem lze odeslat jen vystavenou fakturu.'
                      : 'U odběratele chybí e-mail.'
                }
                style={{
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  backgroundColor: canSendEmail ? '#ffffff' : '#f3f4f6',
                  color: canSendEmail ? '#111827' : '#6b7280',
                  padding: '10px 14px',
                  fontWeight: 800,
                  cursor: canSendEmail ? 'pointer' : 'default',
                }}
              >
                Odeslat e-mailem
              </button>
            </form>

            <Link
              href={`/api/invoices/${invoice.id}/pdf`}
              style={{
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                color: '#111827',
                padding: '10px 14px',
                fontWeight: 800,
                textDecoration: 'none',
              }}
            >
              Stáhnout PDF
            </Link>

            {canExport ? (
              <Link
                href={`/api/invoices/${invoice.id}/csv`}
                style={{
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  color: '#111827',
                  padding: '10px 14px',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                Stáhnout CSV
              </Link>
            ) : (
              <span
                title="CSV lze stáhnout jen pro vystavenou fakturu."
                style={{
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  color: '#6b7280',
                  backgroundColor: '#f3f4f6',
                  padding: '10px 14px',
                  fontWeight: 800,
                }}
              >
                Stáhnout CSV
              </span>
            )}

            {invoice.pohoda_last_export_id ? (
              <Link
                href={`/api/pohoda-exports/${invoice.pohoda_last_export_id}/download`}
                style={{
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  color: '#111827',
                  padding: '10px 14px',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                Stáhnout poslední XML
              </Link>
            ) : null}

            <form action={exportInvoicesToPohoda}>
              <input type="hidden" name="invoiceIds" value={invoice.id} />
              <button
                type="submit"
                disabled={!canExport}
                title={canExport ? undefined : 'Exportovat lze jen vystavenou fakturu.'}
                style={{
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  backgroundColor: canExport ? '#eff6ff' : '#f3f4f6',
                  color: canExport ? '#1d4ed8' : '#6b7280',
                  padding: '10px 14px',
                  fontWeight: 800,
                  cursor: canExport ? 'pointer' : 'default',
                }}
              >
                Export do Pohody
              </button>
            </form>
          </div>
        </section>

        {mailSuccess ? (
          <div
            style={{
              border: '1px solid #bbf7d0',
              backgroundColor: '#f0fdf4',
              color: '#166534',
              borderRadius: '8px',
              padding: '14px',
              fontWeight: 800,
            }}
          >
            Faktura byla odeslána e-mailem.
          </div>
        ) : null}

        {mailError ? (
          <div
            style={{
              border: '1px solid #fecaca',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              borderRadius: '8px',
              padding: '14px',
              fontWeight: 800,
            }}
          >
            Odeslání e-mailem se nepodařilo: {mailError}
          </div>
        ) : null}

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
          <div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '22px' }}>Upravit e-mail a odeslat</h2>
            <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.5 }}>
              Můžete upravit předmět i text zprávy před odesláním faktury zákazníkovi.
            </p>
          </div>

          <form action={sendInvoiceByEmail} style={{ display: 'grid', gap: '12px' }}>
            <input type="hidden" name="invoiceId" value={invoice.id} />

            <label style={labelStyle}>
              <span>Komu</span>
              <input value={customerEmail ?? ''} readOnly style={{ ...inputStyle, backgroundColor: '#f9fafb', color: '#6b7280' }} />
            </label>

            <label style={labelStyle}>
              <span>Předmět</span>
              <input name="subject" defaultValue={defaultMailSubject} style={inputStyle} disabled={!canSendEmail} />
            </label>

            <label style={labelStyle}>
              <span>Zpráva</span>
              <textarea
                name="message"
                defaultValue={defaultMailMessage}
                rows={8}
                disabled={!canSendEmail}
                style={{
                  width: '100%',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  padding: '10px 12px',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  font: 'inherit',
                  backgroundColor: canSendEmail ? '#ffffff' : '#f3f4f6',
                  color: canSendEmail ? '#111827' : '#6b7280',
                }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={!canSendEmail}
                title={
                  canSendEmail
                    ? undefined
                    : customerEmail
                      ? 'E-mailem lze odeslat jen vystavenou fakturu.'
                      : 'U odběratele chybí e-mail.'
                }
                style={{
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  backgroundColor: canSendEmail ? '#ffffff' : '#f3f4f6',
                  color: canSendEmail ? '#111827' : '#6b7280',
                  padding: '10px 14px',
                  fontWeight: 800,
                  cursor: canSendEmail ? 'pointer' : 'default',
                }}
              >
                Odeslat upravený e-mail
              </button>
            </div>
          </form>
        </section>

        {invoice.status === 'draft' ? (
          <form
            action={updateDraftInvoice}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              padding: '16px',
              display: 'grid',
              gap: '18px',
            }}
          >
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '22px' }}>Upravit koncept</h2>
              <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.5 }}>
                Tyto údaje se uloží do faktury. Po vystavení se účetní obsah zamkne.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
              <label style={labelStyle}>
                <span>Číslo faktury</span>
                <input name="invoiceNumber" defaultValue={invoice.invoice_number ?? ''} placeholder="např. 2026-0001" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>Variabilní symbol</span>
                <input name="variableSymbol" defaultValue={invoice.variable_symbol ?? ''} placeholder="automaticky z čísla" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>Datum vystavení</span>
                <input type="date" name="issueDate" defaultValue={toInputDate(invoice.issue_date)} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>DUZP</span>
                <input type="date" name="taxableSupplyDate" defaultValue={toInputDate(invoice.taxable_supply_date)} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>Splatnost</span>
                <input type="date" name="dueDate" defaultValue={toInputDate(invoice.due_date)} style={inputStyle} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <section style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '18px' }}>Dodavatel</h3>
                <label style={labelStyle}>
                  <span>Název</span>
                  <input name="supplierName" defaultValue={getSnapshotString(supplier, 'name') ?? ''} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  <span>Fakturační název</span>
                  <input name="supplierBillingName" defaultValue={getSnapshotString(supplier, 'billingName') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>IČO</span>
                    <input name="supplierCompanyNumber" defaultValue={getSnapshotString(supplier, 'companyNumber') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>DIČ</span>
                    <input name="supplierVatNumber" defaultValue={getSnapshotString(supplier, 'vatNumber') ?? ''} style={inputStyle} />
                  </label>
                </div>
                <label style={labelStyle}>
                  <span>Ulice</span>
                  <input name="supplierBillingStreet" defaultValue={getSnapshotString(supplier, 'billingStreet') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>Město</span>
                    <input name="supplierBillingCity" defaultValue={getSnapshotString(supplier, 'billingCity') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>PSČ</span>
                    <input name="supplierBillingPostalCode" defaultValue={getSnapshotString(supplier, 'billingPostalCode') ?? ''} style={inputStyle} />
                  </label>
                </div>
                <label style={labelStyle}>
                  <span>Stát</span>
                  <input name="supplierBillingCountry" defaultValue={getSnapshotString(supplier, 'billingCountry') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>Číslo účtu</span>
                    <input name="supplierBankAccountNumber" defaultValue={getSnapshotString(supplier, 'bankAccountNumber') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>Kód banky</span>
                    <input name="supplierBankCode" defaultValue={getSnapshotString(supplier, 'bankCode') ?? ''} style={inputStyle} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>IBAN</span>
                    <input name="supplierIban" defaultValue={getSnapshotString(supplier, 'iban') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>SWIFT/BIC</span>
                    <input name="supplierSwiftBic" defaultValue={getSnapshotString(supplier, 'swiftBic') ?? ''} style={inputStyle} />
                  </label>
                </div>
              </section>

              <section style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '18px' }}>Odběratel</h3>
                <label style={labelStyle}>
                  <span>Název</span>
                  <input name="customerName" defaultValue={getSnapshotString(customer, 'name') ?? ''} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  <span>Fakturační název</span>
                  <input name="customerBillingName" defaultValue={getSnapshotString(customer, 'billingName') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>IČO</span>
                    <input name="customerCompanyNumber" defaultValue={getSnapshotString(customer, 'companyNumber') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>DIČ</span>
                    <input name="customerVatNumber" defaultValue={getSnapshotString(customer, 'vatNumber') ?? ''} style={inputStyle} />
                  </label>
                </div>
                <label style={labelStyle}>
                  <span>Ulice</span>
                  <input name="customerBillingStreet" defaultValue={getSnapshotString(customer, 'billingStreet') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>Město</span>
                    <input name="customerBillingCity" defaultValue={getSnapshotString(customer, 'billingCity') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>PSČ</span>
                    <input name="customerBillingPostalCode" defaultValue={getSnapshotString(customer, 'billingPostalCode') ?? ''} style={inputStyle} />
                  </label>
                </div>
                <label style={labelStyle}>
                  <span>Stát</span>
                  <input name="customerBillingCountry" defaultValue={getSnapshotString(customer, 'billingCountry') ?? ''} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={labelStyle}>
                    <span>E-mail</span>
                    <input name="customerEmail" defaultValue={getSnapshotString(customer, 'email') ?? ''} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span>Telefon</span>
                    <input name="customerPhone" defaultValue={getSnapshotString(customer, 'phone') ?? ''} style={inputStyle} />
                  </label>
                </div>
              </section>
            </div>

            <section style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', textAlign: 'left' }}>
                    <th style={{ padding: '10px' }}>Položka</th>
                    <th style={{ padding: '10px' }}>Množství</th>
                    <th style={{ padding: '10px' }}>Jednotka</th>
                    <th style={{ padding: '10px' }}>Cena bez DPH / jednotka</th>
                    <th style={{ padding: '10px' }}>DPH %</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px', minWidth: '260px' }}>
                        <input type="hidden" name="itemIds" value={item.id} />
                        <input name={`itemName_${item.id}`} defaultValue={item.item_name} style={inputStyle} />
                        <textarea
                          name={`itemDescription_${item.id}`}
                          defaultValue={item.description ?? ''}
                          rows={2}
                          style={{ ...inputStyle, height: 'auto', padding: '8px 10px', marginTop: '8px' }}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input name={`itemQuantity_${item.id}`} type="number" step="0.01" min="0.01" defaultValue={item.quantity ?? 1} style={inputStyle} />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input name={`itemUnit_${item.id}`} defaultValue={item.unit ?? 'ks'} style={inputStyle} />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input name={`itemPrice_${item.id}`} type="number" step="0.01" min="0" defaultValue={item.unit_price_without_vat ?? 0} style={inputStyle} />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input name={`itemVatRate_${item.id}`} type="number" step="0.01" min="0" max="100" defaultValue={item.vat_rate ?? 0} style={inputStyle} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <label style={labelStyle}>
              <span>Poznámka</span>
              <textarea
                name="note"
                rows={3}
                defaultValue={(invoice.note ?? '').replace(invoice.vat_note ?? '', '').trim()}
                style={{ borderRadius: '8px', border: '1px solid #d1d5db', padding: '10px', resize: 'vertical' }}
              />
            </label>

            <button
              type="submit"
              style={{
                justifySelf: 'start',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Uložit úpravy konceptu
            </button>
          </form>
        ) : null}

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          <DetailBox label="Číslo faktury" value={invoice.invoice_number ?? 'Koncept'} />
          <DetailBox label="Variabilní symbol" value={invoice.variable_symbol} />
          <DetailBox label="Datum vystavení" value={formatDate(invoice.issue_date)} />
          <DetailBox label="DUZP" value={formatDate(invoice.taxable_supply_date)} />
          <DetailBox label="Splatnost" value={formatDate(invoice.due_date)} />
          <DetailBox label="Forma úhrady" value={invoice.payment_method === 'bank_transfer' ? 'Převodem' : invoice.payment_method} />
          <DetailBox label="DPH" value={invoice.is_vat_payer ? 'Plátce DPH' : 'Neplátce DPH'} />
          <DetailBox label="Export Pohoda" value={formatPohodaExportStatus(invoice.pohoda_export_status)} />
          <DetailBox label="Exportováno" value={formatDateTime(invoice.pohoda_exported_at)} />
        </section>

        {invoice.pohoda_last_error ? (
          <div style={{ border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '14px' }}>
            {invoice.pohoda_last_error}
          </div>
        ) : null}

        {invoice.vat_note ? (
          <div
            style={{
              border: '1px solid #fde68a',
              backgroundColor: '#fef9c3',
              color: '#854d0e',
              borderRadius: '8px',
              padding: '14px',
              fontWeight: 800,
            }}
          >
            {invoice.vat_note}
          </div>
        ) : null}

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            padding: '16px',
            display: 'grid',
            gridTemplateColumns: qrPaymentPayload ? '160px 1fr' : '1fr',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          {qrPaymentPayload ? (
            <>
              <img
                src={`/api/invoices/${invoice.id}/qr`}
                alt="QR platba"
                width={140}
                height={140}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '8px',
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ display: 'grid', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '20px' }}>QR platba</h2>
                <p style={{ margin: 0, color: '#6b7280' }}>
              QR kód je vygenerovaný z údajů faktury: účet dodavatele, částka, CZK a variabilní symbol.
                </p>
                <Link href={`/api/invoices/${invoice.id}/qr`} style={{ color: '#2563eb', fontWeight: 800, textDecoration: 'none' }}>
              Stáhnout QR SVG
                </Link>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: '6px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>QR platba</h2>
              <p style={{ margin: 0, color: '#6b7280' }}>
            Pro QR platbu doplňte u dodavatele IBAN nebo české číslo účtu s kódem banky a zkontrolujte částku faktury.
              </p>
            </div>
          )}
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#ffffff', padding: '16px' }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '22px' }}>Dodavatel</h2>
            <div style={{ display: 'grid', gap: '8px' }}>
              <strong>{getSnapshotString(supplier, 'billingName') || getSnapshotString(supplier, 'name') || '-'}</strong>
              <span>IČO: {getSnapshotString(supplier, 'companyNumber') || '-'}</span>
              <span>DIČ: {getSnapshotString(supplier, 'vatNumber') || '-'}</span>
              <span>
                {[getSnapshotString(supplier, 'billingStreet'), getSnapshotString(supplier, 'billingCity'), getSnapshotString(supplier, 'billingPostalCode')]
                  .filter(Boolean)
                  .join(', ') || '-'}
              </span>
              <span>
                Účet: {[getSnapshotString(supplier, 'bankAccountNumber'), getSnapshotString(supplier, 'bankCode')]
                  .filter(Boolean)
                  .join('/') || '-'}
              </span>
            </div>
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#ffffff', padding: '16px' }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '22px' }}>Odběratel</h2>
            <div style={{ display: 'grid', gap: '8px' }}>
              <strong>{getSnapshotString(customer, 'billingName') || getSnapshotString(customer, 'name') || '-'}</strong>
              <span>IČO: {getSnapshotString(customer, 'companyNumber') || '-'}</span>
              <span>DIČ: {getSnapshotString(customer, 'vatNumber') || '-'}</span>
              <span>
                {[getSnapshotString(customer, 'billingStreet'), getSnapshotString(customer, 'billingCity'), getSnapshotString(customer, 'billingPostalCode')]
                  .filter(Boolean)
                  .join(', ') || '-'}
              </span>
              <span>Email: {getSnapshotString(customer, 'email') || '-'}</span>
            </div>
          </div>
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
            <thead>
              <tr style={{ textAlign: 'left', backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '12px' }}>Položka</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Množství</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Cena bez DPH</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>DPH</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Celkem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '12px' }}>
                    <strong>{item.item_name}</strong>
                    {item.source_job_id ? (
                      <div style={{ marginTop: '4px' }}>
                        <Link href={`/jobs/${item.source_job_id}`} style={{ color: '#2563eb', textDecoration: 'none', fontSize: '12px', fontWeight: 800 }}>
                          Otevřít zakázku
                        </Link>
                      </div>
                    ) : null}
                    {item.description ? (
                      <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px' }}>{item.description}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {item.quantity ?? 1} {item.unit ?? 'ks'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(item.total_without_vat)}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {item.vat_rate ?? 0}% | {formatCurrency(item.vat_amount)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                    {formatCurrency(item.total_with_vat)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                <td colSpan={2} style={{ padding: '12px', fontWeight: 800 }}>
                  Součet
                </td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                  {formatCurrency(invoice.subtotal_without_vat)}
                </td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800 }}>
                  {formatCurrency(invoice.vat_total)}
                </td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 900 }}>
                  {formatCurrency(invoice.total_with_vat)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {invoice.note ? (
          <section style={{ border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#ffffff', padding: '16px' }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>Poznámka</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{invoice.note}</p>
          </section>
        ) : null}
      </main>
    </DashboardShell>
  )
}
