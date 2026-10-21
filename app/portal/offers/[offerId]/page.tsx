import Link from 'next/link'
import { notFound } from 'next/navigation'

import PublicOfferPage from '@/components/PublicOfferPage'
import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalOfferDetail } from '@/lib/customer-portal/data'
import { QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL } from '@/lib/quote-customer-identity'

type OfferDetailPageProps = {
  params: Promise<{
    offerId: string
  }>
}

export default async function PortalOfferDetailPage({ params }: OfferDetailPageProps) {
  const portalUser = await requirePortalUserContext()
  const { offerId } = await params
  const offer = await getPortalOfferDetail(portalUser.customerId, portalUser.companyId ?? '', offerId)

  if (!offer) {
    notFound()
  }

  return (
    <PortalShell title="Detail nabídky" customerName={portalUser.customerName}>
      <div style={{ display: 'grid', gap: '16px' }}>
        <Link href="/portal/offers" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          ← Zpět na nabídky
        </Link>

        {offer.customerIdentityState === 'legacy_unknown' ? <p role="status" style={{
          margin: 0, padding: '12px 16px', borderRadius: '12px', background: '#f5f3ff', color: '#4c1d95',
        }}>{QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL}</p> : null}

        {offer.customerAddressLabel ? <section aria-label="Adresa zákazníka v nabídce" style={{
          padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff',
        }}>
          <strong>Adresa zákazníka v nabídce</strong>
          <p style={{ margin: '6px 0 0', color: '#475569' }}>{offer.customerAddressLabel}</p>
        </section> : null}

        <PublicOfferPage
          token={offer.id}
          context="portal"
          title={offer.title}
          customerName={offer.customerName}
          defaultCustomerEmail={portalUser.email}
          defaultCustomerPhone={null}
          validUntil={offer.validUntil}
          benefitsText={offer.benefitsText}
          contactName={offer.contactName}
          contactEmail={offer.contactEmail}
          priceTotal={offer.priceTotal}
          pricingTitle={offer.pricingTitle || 'Cenová kalkulace'}
          pricingText={offer.pricingText}
          preparedByName={offer.preparedByName}
          preparedAt={offer.preparedAt}
          updatedAt={offer.updatedAt}
          pdfHref={null}
          sections={[
            {
              key: 'intro',
              title: 'Úvod',
              content: offer.summary,
            },
            {
              key: 'customer_request',
              title: offer.customerRequestTitle || 'Zadání zákazníka',
              content: offer.customerRequest,
            },
            {
              key: 'our_solution',
              title: offer.solutionTitle || 'Navržené řešení',
              content: offer.solution,
            },
            {
              key: 'work_description',
              title: 'Důležité informace',
              content: offer.workDescription,
            },
            {
              key: 'timeline',
              title: offer.timelineTitle || 'Termín a organizace',
              content: offer.schedule,
            },
            {
              key: 'payment_terms',
              title: offer.paymentTermsTitle || 'Platební podmínky',
              content: offer.paymentTerms,
            },
          ]}
          items={offer.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            note: item.note,
          }))}
        />
      </div>
    </PortalShell>
  )
}
