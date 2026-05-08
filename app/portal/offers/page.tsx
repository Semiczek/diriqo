import Link from 'next/link'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalOffers } from '@/lib/customer-portal/data'

export default async function PortalOffersPage() {
  const portalUser = await requirePortalUserContext()
  const offers = await getPortalOffers(portalUser.customerId, portalUser.companyId ?? '')

  return (
    <PortalShell title="Nabídky" customerName={portalUser.customerName}>
      <section style={{ display: 'grid', gap: '14px' }}>
        {offers.length === 0 ? (
          <div
            style={{
              borderRadius: '18px',
              border: '1px solid #e5e7eb',
              backgroundColor: '#ffffff',
              padding: '22px',
              color: '#6b7280',
            }}
          >
            Zatím zde nejsou žádné nabídky.
          </div>
        ) : (
          offers.map((offer) => (
            <article
              key={offer.id}
              style={{
                borderRadius: '18px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#ffffff',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <div style={{ color: '#6b7280', fontSize: '14px' }}>{offer.quoteNumber}</div>
                  <div style={{ fontSize: '24px', fontWeight: 800 }}>{offer.title}</div>
                  {offer.summary ? <div style={{ color: '#374151', lineHeight: 1.6 }}>{offer.summary}</div> : null}
                  <div style={{ color: '#6b7280' }}>Cena: {offer.totalPriceLabel}</div>
                  <div style={{ color: '#6b7280' }}>Platnost do: {offer.validUntilLabel}</div>
                </div>

                <div style={{ display: 'grid', gap: '10px', justifyItems: 'end' }}>
                  <div
                    style={{
                      borderRadius: '999px',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      backgroundColor: '#eff6ff',
                      color: '#1d4ed8',
                      fontWeight: 700,
                    }}
                  >
                    {offer.statusLabel}
                  </div>

                  {offer.canApprove ? (
                    <div style={{ color: '#166534', fontWeight: 700 }}>Lze potvrdit v portálu</div>
                  ) : null}

                  <Link
                    href={`/portal/offers/${offer.id}`}
                    style={{
                      textDecoration: 'none',
                      borderRadius: '12px',
                      backgroundColor: '#111827',
                      color: '#ffffff',
                      padding: '10px 14px',
                      fontWeight: 700,
                    }}
                  >
                    Detail
                  </Link>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </PortalShell>
  )
}
