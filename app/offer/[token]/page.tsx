import PublicOfferPage from '@/components/PublicOfferPage'
import { getPublicCoreQuote } from '@/lib/dal/core-quote-customer-read'
import { coreQuotePresentation } from '@/lib/core-quote-presentation'
import { QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL } from '@/lib/quote-customer-identity'

export default async function PublicOfferDetailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const read = await getPublicCoreQuote(token)
  if (!read) return <main style={{ maxWidth: 620, margin: '80px auto', padding: 24 }}>
    <h1>Nabídka není dostupná</h1>
    <p>Odkaz není platný nebo jeho platnost skončila. Vyžádejte si aktuální odkaz od dodavatele.</p>
  </main>
  return <>
    {read.document.customer_identity_state === 'legacy_unknown' ? <p role="status" style={{ padding: 16 }}>{QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL}</p> : null}
    <PublicOfferPage {...coreQuotePresentation(read, token, 'public', `/api/offers/${encodeURIComponent(token)}/pdf`)} />
  </>
}
