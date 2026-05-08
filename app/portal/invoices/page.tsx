import Link from 'next/link'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalInvoices } from '@/lib/customer-portal/data'

export default async function PortalInvoicesPage() {
  const portalUser = await requirePortalUserContext()
  const invoices = await getPortalInvoices(portalUser.customerId, portalUser.companyId ?? '')
  const invoicesByMonth = invoices.reduce<Array<{ monthKey: string; monthLabel: string; items: typeof invoices }>>(
    (groups, invoice) => {
      const monthKey = invoice.monthValue ?? 'unknown'
      const existingGroup = groups.find((group) => group.monthKey === monthKey)

      if (existingGroup) {
        existingGroup.items.push(invoice)
        return groups
      }

      groups.push({
        monthKey,
        monthLabel: invoice.monthLabel,
        items: [invoice],
      })

      return groups
    },
    []
  )

  return (
    <PortalShell title="Fakturace" customerName={portalUser.customerName}>
      <section
        style={{
          borderRadius: '18px',
          border: '1px solid #e5e7eb',
          backgroundColor: '#ffffff',
          padding: '24px',
          display: 'grid',
          gap: '16px',
        }}
      >
        {invoices.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280' }}>{'Zat\u00edm nebylo fakturov\u00e1no'}</p>
        ) : (
          invoicesByMonth.map((group) => (
            <section key={group.monthKey} style={{ display: 'grid', gap: '14px' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#111827' }}>{group.monthLabel}</div>

              {group.items.map((invoice) => (
                <article
                  key={invoice.id}
                  style={{
                    borderRadius: '14px',
                    border: '1px solid #e5e7eb',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ color: '#6b7280', fontSize: '14px' }}>Faktura</div>
                      <Link
                        href={invoice.detailHref}
                        style={{
                          display: 'inline-block',
                          fontSize: '22px',
                          fontWeight: 800,
                          color: '#111827',
                          textDecoration: 'none',
                        }}
                      >
                        {invoice.invoiceNumber}
                      </Link>
                      {invoice.variableSymbol ? (
                        <div style={{ color: '#6b7280', marginTop: '4px' }}>VS: {invoice.variableSymbol}</div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '22px', fontWeight: 800 }}>{invoice.totalWithVatLabel}</div>
                      <div style={{ color: invoice.paidAtLabel ? '#166534' : '#6b7280', marginTop: '4px' }}>
                        {invoice.statusLabel}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', color: '#4b5563' }}>
                    <div>{'Vystaveno: '}{invoice.issueDateLabel}</div>
                    <div>{'Splatnost: '}{invoice.dueDateLabel}</div>
                    {invoice.paidAtLabel ? <div>{'Zaplaceno: '}{invoice.paidAtLabel}</div> : null}
                  </div>

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <Link
                      href={invoice.detailHref}
                      style={{
                        width: 'fit-content',
                        textDecoration: 'none',
                        borderRadius: '12px',
                        border: '1px solid #d1d5db',
                        backgroundColor: '#ffffff',
                        color: '#111827',
                        padding: '10px 14px',
                        fontWeight: 700,
                      }}
                    >
                      {'Zobrazit fakturu'}
                    </Link>

                    {invoice.pdfHref ? (
                      <a
                        href={invoice.pdfHref}
                        style={{
                          width: 'fit-content',
                          textDecoration: 'none',
                          borderRadius: '12px',
                          border: '1px solid #d1d5db',
                          backgroundColor: '#f9fafb',
                          color: '#111827',
                          padding: '10px 14px',
                          fontWeight: 700,
                        }}
                      >
                        {'St\u00e1hnout PDF'}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          ))
        )}
      </section>
    </PortalShell>
  )
}
