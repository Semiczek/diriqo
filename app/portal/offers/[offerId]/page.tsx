import Link from 'next/link'
import { notFound } from 'next/navigation'

import PublicOfferPage from '@/components/PublicOfferPage'
import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalOfferDetail } from '@/lib/customer-portal/data'

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

        <PublicOfferPage
          token={offer.id}
          context="portal"
          title={offer.title}
          customerName={portalUser.customerName}
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
