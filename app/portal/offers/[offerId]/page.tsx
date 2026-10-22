import Link from 'next/link'
import { notFound } from 'next/navigation'
import PublicOfferPage from '@/components/PublicOfferPage'
import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { parsePortalQuoteSelector } from '@/lib/dal/core-quote-customer-read'
import { getPortalOfferDetail } from '@/lib/customer-portal/data'
import { coreQuotePresentation } from '@/lib/core-quote-presentation'
import { QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL } from '@/lib/quote-customer-identity'

export default async function PortalOfferDetailPage({ params, searchParams }: {
  params: Promise<{ offerId: string }>; searchParams?: Promise<{ versionId?: string | string[]; legacy?: string | string[] }>
}) {
  const portalUser = await requirePortalUserContext()
  const { offerId } = await params
  let versionId: string | null
  try { versionId = parsePortalQuoteSelector((await searchParams) ?? {}) } catch { notFound() }
  const offer = await getPortalOfferDetail(portalUser.customerId, portalUser.companyId ?? '', offerId, versionId)
  if (!offer) notFound()
  const d = offer.read.document
  const pdfHref = d.version_id ? `/api/portal/offers/${offerId}/pdf?versionId=${d.version_id}` : `/api/portal/offers/${offerId}/pdf?legacy=1`
  return <PortalShell title="Detail nabídky" customerName={portalUser.customerName}>
    <Link href="/portal/offers">← Zpět na nabídky</Link>
    {offer.read.kind === 'legacy' ? <section><h1>Starší nabídka</h1><p>Dochovaný stav zachycen {new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(offer.read.legacyCapturedAt!))}. Tento čas nedokládá původní datum vydání.</p></section> : null}
    {offer.customerIdentityState === 'legacy_unknown' ? <p role="status">{QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL}</p> : null}
    {offer.customerAddressLabel ? <p>Adresa zákazníka v nabídce: {offer.customerAddressLabel}</p> : null}
    <PublicOfferPage {...coreQuotePresentation(offer.read, offerId, 'portal', pdfHref)} defaultCustomerEmail={portalUser.email} responseActorId={portalUser.portalUserId} />
  </PortalShell>
}
