import Link from 'next/link'
import { notFound } from 'next/navigation'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalInvoiceDetail } from '@/lib/customer-portal/data'

type PortalInvoiceDetailPageProps = {
  params: Promise<{
    invoiceId: string
  }>
}

function DetailBox({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div
      style={{
        borderRadius: '14px',
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
        padding: '16px',
        display: 'grid',
        gap: '6px',
      }}
    >
      <div style={{ color: '#6b7280', fontSize: '13px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontWeight: 800, color: '#111827' }}>{value || 'Neuvedeno'}</div>
    </div>
  )
}

export default async function PortalInvoiceDetailPage({ params }: PortalInvoiceDetailPageProps) {
  const portalUser = await requirePortalUserContext()
  const { invoiceId } = await params
  const invoice = await getPortalInvoiceDetail(portalUser.customerId, portalUser.companyId ?? '', invoiceId)

  if (!invoice) {
    notFound()
  }

  return (
    <PortalShell title="Detail faktury" customerName={portalUser.customerName}>
      <div style={{ display: 'grid', gap: '20px' }}>
        <Link href="/portal/invoices" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          ← Zpět na fakturaci
        </Link>

        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            padding: '24px',
            display: 'grid',
            gap: '18px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ color: '#6b7280', fontSize: '14px' }}>Faktura</div>
              <h2 style={{ margin: 0, fontSize: '34px', lineHeight: 1.1 }}>{invoice.invoiceNumber}</h2>
              {invoice.variableSymbol ? <div style={{ color: '#4b5563' }}>VS: {invoice.variableSymbol}</div> : null}
            </div>

            <div style={{ display: 'grid', gap: '10px', justifyItems: 'end' }}>
              <div style={{ fontSize: '30px', fontWeight: 900 }}>{invoice.totalWithVatLabel}</div>
              <div
                style={{
                  borderRadius: '999px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#f9fafb',
                  color: '#111827',
                  padding: '8px 12px',
                  fontWeight: 700,
                }}
              >
                {invoice.statusLabel}
              </div>
              {invoice.pdfHref ? (
                <a
                  href={invoice.pdfHref}
                  style={{
                    textDecoration: 'none',
                    borderRadius: '12px',
                    border: '1px solid #d1d5db',
                    backgroundColor: '#f9fafb',
                    color: '#111827',
                    padding: '10px 14px',
                    fontWeight: 700,
                  }}
                >
                  Stáhnout PDF
                </a>
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            <DetailBox label="Vystavení" value={invoice.issueDateLabel} />
            <DetailBox label="DUZP" value={invoice.taxableSupplyDateLabel} />
            <DetailBox label="Splatnost" value={invoice.dueDateLabel} />
            <DetailBox label="Forma úhrady" value={invoice.paymentMethodLabel} />
            <DetailBox label="DPH" value={invoice.vatPayerLabel} />
            <DetailBox label="Zaplaceno" value={invoice.paidAtLabel ?? 'Neuhrazeno'} />
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ borderRadius: '18px', border: '1px solid #e5e7eb', backgroundColor: '#ffffff', padding: '22px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '22px' }}>Dodavatel</h3>
            <div style={{ display: 'grid', gap: '8px', color: '#111827' }}>
              <strong>{invoice.supplierName}</strong>
              <span>IČO: {invoice.supplierCompanyNumber || '-'}</span>
              <span>DIČ: {invoice.supplierVatNumber || '-'}</span>
              <span>{invoice.supplierAddressLabel}</span>
              <span>Účet: {invoice.supplierBankAccountLabel}</span>
            </div>
          </div>

          <div style={{ borderRadius: '18px', border: '1px solid #e5e7eb', backgroundColor: '#ffffff', padding: '22px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '22px' }}>Odběratel</h3>
            <div style={{ display: 'grid', gap: '8px', color: '#111827' }}>
              <strong>{invoice.customerName}</strong>
              <span>IČO: {invoice.customerCompanyNumber || '-'}</span>
              <span>DIČ: {invoice.customerVatNumber || '-'}</span>
              <span>{invoice.customerAddressLabel}</span>
              <span>E-mail: {invoice.customerEmail || '-'}</span>
            </div>
          </div>
        </section>

        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            padding: '24px',
            display: 'grid',
            gridTemplateColumns: invoice.hasQrPayment ? '160px 1fr' : '1fr',
            gap: '18px',
            alignItems: 'center',
          }}
        >
          {invoice.hasQrPayment ? (
            <>
              <img
                src={`/api/portal/invoices/${invoice.id}/qr`}
                alt="QR platba"
                width={140}
                height={140}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '8px',
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ display: 'grid', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '22px' }}>QR platba</h3>
                <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.6 }}>
                  QR kód je vygenerovaný z údajů faktury pro rychlou úhradu v bankovní aplikaci.
                </p>
                <a
                  href={`/api/portal/invoices/${invoice.id}/qr`}
                  style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}
                >
                  Stáhnout QR SVG
                </a>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '22px' }}>QR platba</h3>
              <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.6 }}>
                QR kód není k dispozici, protože u dodavatele chybí platební údaje nebo částka faktury.
              </p>
            </div>
          )}
        </section>

        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', textAlign: 'left' }}>
                <th style={{ padding: '14px 16px' }}>Položka</th>
                <th style={{ padding: '14px 16px' }}>Množství</th>
                <th style={{ padding: '14px 16px' }}>Cena bez DPH</th>
                <th style={{ padding: '14px 16px' }}>DPH</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>Celkem</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 700 }}>{item.itemName}</div>
                    {item.description ? (
                      <div style={{ color: '#6b7280', marginTop: '4px', lineHeight: 1.5 }}>{item.description}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {item.quantityLabel} {item.unit}
                  </td>
                  <td style={{ padding: '14px 16px' }}>{item.unitPriceWithoutVatLabel}</td>
                  <td style={{ padding: '14px 16px' }}>
                    {item.vatRateLabel} | {item.vatAmountLabel}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 800 }}>{item.totalWithVatLabel}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <td style={{ padding: '14px 16px', fontWeight: 800 }}>Součet</td>
                <td style={{ padding: '14px 16px' }} />
                <td style={{ padding: '14px 16px', fontWeight: 800 }}>{invoice.subtotalWithoutVatLabel}</td>
                <td style={{ padding: '14px 16px', fontWeight: 800 }}>{invoice.vatTotalLabel}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 900 }}>{invoice.totalWithVatLabel}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {invoice.vatNote ? (
          <section style={{ borderRadius: '18px', border: '1px solid #fde68a', backgroundColor: '#fef9c3', padding: '18px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '22px' }}>Poznámka k DPH</h3>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{invoice.vatNote}</p>
          </section>
        ) : null}

        {invoice.note ? (
          <section style={{ borderRadius: '18px', border: '1px solid #e5e7eb', backgroundColor: '#ffffff', padding: '18px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '22px' }}>Poznámka</h3>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{invoice.note}</p>
          </section>
        ) : null}
      </div>
    </PortalShell>
  )
}
