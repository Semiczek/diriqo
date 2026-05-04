import PublicOfferPage from '@/components/PublicOfferPage'
import { getRequestDictionary } from '@/lib/i18n/server'
import { resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabasePublicClient } from '@/lib/supabase-public'

type PageProps = {
  params: Promise<{
    token: string
  }>
}

type PublicQuoteRow = {
  id: string
  title: string
  status: string | null
  valid_until: string | null
  intro_text: string | null
  contact_name: string | null
  contact_email: string | null
  customer_request_title: string | null
  customer_request: string | null
  our_solution_title: string | null
  proposed_solution: string | null
  timeline_title: string | null
  work_description: string | null
  work_schedule: string | null
  pricing_title: string | null
  pricing_text: string | null
  payment_terms_title: string | null
  payment_terms: string | null
  benefits_text: string | null
  total_price: number | null
  customer_name: string | null
  created_at: string | null
  updated_at: string | null
  creator_name: string | null
}

type PublicQuoteItemRow = {
  id: string
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

function PublicStateCard({ title, text }: { title: string; text: string }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f8fafc',
        padding: '32px 16px',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <section
        style={{
          maxWidth: '640px',
          width: '100%',
          borderRadius: '24px',
          border: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          padding: '28px',
          textAlign: 'center',
          color: '#111827',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: '12px', fontSize: '34px' }}>{title}</h1>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.7 }}>{text}</p>
      </section>
    </main>
  )
}

export default async function PublicOfferDetailPage({ params }: PageProps) {
  const { token } = await params
  const dictionary = await getRequestDictionary()
  const t = dictionary.publicOffer
  const supabase = createSupabasePublicClient()

  const { data: quote, error: quoteError } = await supabase
    .rpc('get_public_offer_by_token', {
      input_token: token,
    })
    .maybeSingle()

  if (quoteError || !quote) {
    return (
      <PublicStateCard
        title={t.notFoundTitle}
        text={t.notFoundText}
      />
    )
  }

  const normalizedQuote = quote as PublicQuoteRow
  const status = resolveQuoteStatus(normalizedQuote.status, normalizedQuote.valid_until)

  if (status === 'expired') {
    return (
      <PublicStateCard
        title={t.expiredTitle}
        text={t.expiredText}
      />
    )
  }

  const { data: items, error: itemsError } = await supabase.rpc('get_public_offer_items_by_token', {
    input_token: token,
  })

  if (itemsError) {
    return (
      <PublicStateCard
        title={t.loadFailedTitle}
        text={t.loadFailedText}
      />
    )
  }

  return (
    <PublicOfferPage
      token={token}
      title={normalizedQuote.title}
      customerName={normalizedQuote.customer_name}
      validUntil={normalizedQuote.valid_until}
      benefitsText={normalizedQuote.benefits_text}
      contactName={normalizedQuote.contact_name}
      contactEmail={normalizedQuote.contact_email}
      priceTotal={normalizedQuote.total_price}
      pricingTitle={normalizedQuote.pricing_title || t.pricingFallback}
      pricingText={normalizedQuote.pricing_text}
      preparedByName={normalizedQuote.creator_name}
      preparedAt={normalizedQuote.created_at}
      updatedAt={normalizedQuote.updated_at}
      pdfHref={`/api/offers/${encodeURIComponent(token)}/pdf`}
      sections={[
        {
          key: 'intro',
          title: t.introFallback,
          content: normalizedQuote.intro_text,
        },
        {
          key: 'customer_request',
          title: normalizedQuote.customer_request_title || t.customerRequestFallback,
          content: normalizedQuote.customer_request,
        },
        {
          key: 'our_solution',
          title: normalizedQuote.our_solution_title || t.solutionFallback,
          content: normalizedQuote.proposed_solution,
        },
        {
          key: 'work_description',
          title: t.importantInfoFallback,
          content: normalizedQuote.work_description,
        },
        {
          key: 'timeline',
          title: normalizedQuote.timeline_title || t.timelineFallback,
          content: normalizedQuote.work_schedule,
        },
        {
          key: 'payment_terms',
          title: normalizedQuote.payment_terms_title || t.paymentTermsFallback,
          content: normalizedQuote.payment_terms,
        },
      ]}
      items={((items ?? []) as PublicQuoteItemRow[]).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unit_price,
        totalPrice: item.total_price,
        note: item.note,
      }))}
    />
  )
}


