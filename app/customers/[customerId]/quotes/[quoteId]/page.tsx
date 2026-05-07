import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import EntityCommunicationTimeline from '@/components/EntityCommunicationTimeline'
import QuoteActionsPanel from '@/components/QuoteActionsPanel'
import {
  SecondaryAction,
  StatusPill,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  pageShellStyle,
} from '@/components/SaasPageLayout'
import { getActiveCompanyContext } from '@/lib/active-company'
import { listEntityThreadMessages } from '@/lib/email/listEntityThreadMessages'
import { getRequestDictionary } from '@/lib/i18n/server'
import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { getQuoteStatusLabel, getQuoteStatusStyle, resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
    quoteId: string
  }>
}

type QuoteRow = {
  id: string
  company_id: string
  customer_id: string
  quote_number: string
  share_token: string | null
  title: string
  status: string | null
  quote_date: string | null
  valid_until: string | null
  contact_name: string | null
  contact_email: string | null
  intro_text: string | null
  customer_note: string | null
  internal_note: string | null
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
  subtotal_price: number | null
  discount_amount: number | null
  total_price: number | null
  source_calculation_id: string | null
  sent_at: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  view_count: number | null
  customers?: {
    name: string | null
  }[] | null
}

type QuoteItemRow = {
  id: string
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type OfferEventRow = {
  id: string
  section_key: string | null
  event_type: string
  event_value: string | null
  visitor_id: string | null
  user_agent: string | null
  device_type: string | null
  referrer: string | null
  created_at: string
}

type OfferResponseRow = {
  id: string
  action_type:
    | 'interested'
    | 'contact_requested'
    | 'revision_requested'
    | 'not_interested'
    | string
  customer_name: string
  customer_email: string
  customer_phone: string
  note: string | null
  created_at: string
}

type CalculationVersionRow = {
  id: string
  calculation_id: string
  version_number: number
  title: string
  status: string | null
  subtotal_cost: number | null
  subtotal_price: number | null
  total_price: number | null
  saved_at: string
}

const emptyQuoteDetails = {
  share_token: null,
  contact_name: null,
  contact_email: null,
  intro_text: null,
  customer_note: null,
  internal_note: null,
  customer_request_title: null,
  customer_request: null,
  our_solution_title: null,
  proposed_solution: null,
  timeline_title: null,
  work_description: null,
  work_schedule: null,
  pricing_title: null,
  pricing_text: null,
  payment_terms_title: null,
  payment_terms: null,
  discount_amount: null,
  first_viewed_at: null,
  last_viewed_at: null,
  view_count: null,
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '-'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('cs-CZ')
}

function getAppBaseUrl() {
  return getPublicAppBaseUrl()
}

function getSectionLabel(
  sectionKey: string | null,
  quote: QuoteRow,
  dictionary: Awaited<ReturnType<typeof getRequestDictionary>>,
) {
  if (sectionKey === 'intro') return dictionary.customers.quoteDetail.sectionIntro
  if (sectionKey === 'customer_request') {
    return quote.customer_request_title || dictionary.customers.quoteDetail.sectionCustomerRequest
  }
  if (sectionKey === 'our_solution') {
    return quote.our_solution_title || dictionary.customers.quoteDetail.sectionOurSolution
  }
  if (sectionKey === 'work_description') {
    return dictionary.customers.quoteDetail.sectionWorkDescription
  }
  if (sectionKey === 'timeline') {
    return quote.timeline_title || dictionary.customers.quoteDetail.sectionTimeline
  }
  if (sectionKey === 'pricing') {
    return quote.pricing_title || dictionary.customers.quoteDetail.sectionPricing
  }
  if (sectionKey === 'payment_terms') {
    return quote.payment_terms_title || dictionary.customers.quoteDetail.sectionPaymentTerms
  }
  return dictionary.customers.quoteDetail.sectionGeneral
}

function getEventLabel(
  eventType: string,
  dictionary: Awaited<ReturnType<typeof getRequestDictionary>>,
) {
  if (eventType === 'offer_opened') return dictionary.customers.quoteDetail.eventOfferOpened
  if (eventType === 'offer_engaged') return dictionary.customers.quoteDetail.eventOfferEngaged
  if (eventType === 'section_viewed') return dictionary.customers.quoteDetail.eventSectionViewed
  if (eventType === 'section_expanded') return dictionary.customers.quoteDetail.eventSectionExpanded
  if (eventType === 'pricing_viewed') return dictionary.customers.quoteDetail.eventPricingViewed
  if (eventType === 'cta_interested') return dictionary.customers.quoteDetail.eventInterestedCta
  if (eventType === 'cta_interested_submitted') return dictionary.customers.quoteDetail.eventInterestedSubmitted
  if (eventType === 'cta_revision') return dictionary.customers.quoteDetail.eventRevisionCta
  if (eventType === 'cta_revision_submitted') return dictionary.customers.quoteDetail.eventRevisionSubmitted
  if (eventType === 'cta_not_interested') return dictionary.customers.quoteDetail.eventNotInterestedCta
  if (eventType === 'cta_not_interested_submitted') return dictionary.customers.quoteDetail.eventNotInterestedSubmitted
  if (eventType === 'cta_contact') return dictionary.customers.quoteDetail.eventContactCta
  if (eventType === 'cta_contact_submitted') return dictionary.customers.quoteDetail.eventContactSubmitted
  return eventType
}

function getOfferResponseLabel(
  actionType: string,
  dictionary: Awaited<ReturnType<typeof getRequestDictionary>>,
) {
  if (actionType === 'interested') return dictionary.customers.quoteDetail.responseInterested
  if (actionType === 'revision_requested') return dictionary.customers.quoteDetail.responseRevisionRequested
  if (actionType === 'not_interested') return dictionary.customers.quoteDetail.responseNotInterested
  if (actionType === 'contact_requested') return dictionary.customers.quoteDetail.responseContactRequested
  return actionType
}

function getOfferResponseStyle(actionType: string) {
  if (actionType === 'interested') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  if (actionType === 'revision_requested') {
    return {
      backgroundColor: '#ffedd5',
      color: '#9a3412',
      border: '1px solid #fdba74',
    }
  }

  if (actionType === 'not_interested') {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    }
  }

  return {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
  }
}

export default async function QuoteDetailPage({ params }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId, quoteId } = await params
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="quotes">
        <main style={pageShellStyle}>
          <p>Nemate pristup do interniho Hubu.</p>
        </main>
      </DashboardShell>
    )
  }

  const supabase = await createSupabaseServerClient()

  const [
    { data: quote, error: quoteError },
    { data: items, error: itemsError },
    { data: events, error: eventsError },
    { data: responses, error: responsesError },
  ] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        'id, company_id, customer_id, source_calculation_id, quote_number, title, status, quote_date, valid_until, subtotal_price, total_price, share_token, sent_at',
      )
      .eq('id', quoteId)
      .eq('company_id', activeCompany.companyId)
      .maybeSingle(),
    supabase
      .from('quote_items')
      .select('id, name, description, quantity, unit, unit_price, total_price, note')
      .eq('quote_id', quoteId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('offer_events')
      .select('id, event_type, visitor_id, created_at')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('offer_responses')
      .select('id, action_type, customer_name, customer_email, customer_phone, note, created_at')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (quoteError || !quote) {
    if (quoteError) {
      console.error('[QUOTES] Failed to load quote detail base row', {
        quoteId,
        customerId,
        companyId: activeCompany.companyId,
        message: quoteError.message,
        details: quoteError.details,
        hint: quoteError.hint,
        code: quoteError.code,
      })
    }

    return (
      <DashboardShell activeItem="quotes">
        <main style={pageShellStyle}>
          {quoteError ? (
            <div
              style={{
                border: '1px solid #fed7aa',
                backgroundColor: '#fff7ed',
                color: '#9a3412',
                borderRadius: '16px',
                padding: '20px',
                lineHeight: 1.5,
              }}
            >
              <strong>Nepodařilo se načíst cenovou nabídku.</strong>
              <div>{quoteError.message}</div>
              <div style={{ marginTop: '8px', color: '#7c2d12', fontSize: '14px' }}>
                Zkontroluj, jestli v Supabase existuje řádek v tabulce quotes a jestli má tabulka
                všechny runtime sloupce pro detail nabídky.
              </div>
            </div>
          ) : (
            <p>{dictionary.customers.quoteDetail.notFound}</p>
          )}
        </main>
      </DashboardShell>
    )
  }

  const normalizedQuote = {
    ...emptyQuoteDetails,
    ...(quote as unknown as Omit<
      QuoteRow,
      | 'share_token'
      | 'contact_name'
      | 'contact_email'
      | 'intro_text'
      | 'customer_note'
      | 'internal_note'
      | 'customer_request_title'
      | 'customer_request'
      | 'our_solution_title'
      | 'proposed_solution'
      | 'timeline_title'
      | 'work_description'
      | 'work_schedule'
      | 'pricing_title'
      | 'pricing_text'
      | 'payment_terms_title'
      | 'payment_terms'
      | 'discount_amount'
      | 'first_viewed_at'
      | 'last_viewed_at'
      | 'view_count'
    >),
  } as QuoteRow
  const quoteCustomerId = normalizedQuote.customer_id || customerId
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('name')
    .eq('id', quoteCustomerId)
    .maybeSingle()

  if (customerError) {
    console.error('[QUOTES] Failed to load quote customer', {
      quoteId,
      customerId: quoteCustomerId,
      message: customerError.message,
      details: customerError.details,
      hint: customerError.hint,
      code: customerError.code,
    })
  }

  let quoteItems = (items ?? []) as QuoteItemRow[]
  let quoteItemsError = itemsError

  if (!quoteItemsError && quoteItems.length === 0 && normalizedQuote.source_calculation_id) {
    const { data: calculationItems, error: calculationItemsError } = await supabase
      .from('calculation_items')
      .select('id, name, description, quantity, unit, unit_price, total_price, note')
      .eq('calculation_id', normalizedQuote.source_calculation_id)
      .eq('item_type', 'customer')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (calculationItemsError) {
      quoteItemsError = calculationItemsError
      console.error('[QUOTES] Failed to load fallback calculation items', {
        quoteId,
        sourceCalculationId: normalizedQuote.source_calculation_id,
        message: calculationItemsError.message,
        details: calculationItemsError.details,
        hint: calculationItemsError.hint,
        code: calculationItemsError.code,
      })
    } else {
      quoteItems = (calculationItems ?? []) as QuoteItemRow[]
    }
  }

  if (!quoteItemsError && quoteItems.length === 0 && normalizedQuote.source_calculation_id) {
    const { data: latestVersion, error: latestVersionError } = await supabase
      .from('calculation_versions')
      .select('id')
      .eq('calculation_id', normalizedQuote.source_calculation_id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestVersionError) {
      console.error('[QUOTES] Failed to load latest calculation version for item fallback', {
        quoteId,
        sourceCalculationId: normalizedQuote.source_calculation_id,
        message: latestVersionError.message,
        details: latestVersionError.details,
        hint: latestVersionError.hint,
        code: latestVersionError.code,
      })
    } else if (latestVersion?.id) {
      const { data: versionItems, error: versionItemsError } = await supabase
        .from('calculation_version_items')
        .select('id, name, description, quantity, unit, unit_price, total_price, note')
        .eq('calculation_version_id', latestVersion.id)
        .eq('item_type', 'customer')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (versionItemsError) {
        quoteItemsError = versionItemsError
        console.error('[QUOTES] Failed to load fallback calculation version items', {
          quoteId,
          sourceCalculationId: normalizedQuote.source_calculation_id,
          calculationVersionId: latestVersion.id,
          message: versionItemsError.message,
          details: versionItemsError.details,
          hint: versionItemsError.hint,
          code: versionItemsError.code,
        })
      } else {
        quoteItems = (versionItems ?? []) as QuoteItemRow[]
      }
    }
  }

  const { data: calculationVersions, error: calculationVersionsError } =
    normalizedQuote.source_calculation_id
      ? await supabase
          .from('calculation_versions')
          .select(
            'id, calculation_id, version_number, title, status, subtotal_cost, subtotal_price, total_price, saved_at',
          )
          .eq('calculation_id', normalizedQuote.source_calculation_id)
          .order('version_number', { ascending: false })
          .limit(20)
      : { data: [], error: null }

  const resolvedStatus = resolveQuoteStatus(normalizedQuote.status, normalizedQuote.valid_until)
  const shareUrl = normalizedQuote.share_token
    ? (() => {
        const baseUrl = getAppBaseUrl()
        return baseUrl
          ? `${baseUrl}/offer/${normalizedQuote.share_token}`
          : `/offer/${normalizedQuote.share_token}`
      })()
    : null
  const offerEvents = ((events ?? []) as Array<Pick<OfferEventRow, 'id' | 'event_type' | 'visitor_id' | 'created_at'>>).map((event) => ({
    ...event,
    section_key: null,
    event_value: null,
    user_agent: null,
    device_type: null,
    referrer: null,
  })) as OfferEventRow[]
  const offerResponses = (responses ?? []) as OfferResponseRow[]
  let communicationFeed = [] as Awaited<
    ReturnType<typeof listEntityThreadMessages>
  >['feedItems']

  if (normalizedQuote.company_id) {
    try {
      const communication = await listEntityThreadMessages(
        supabase,
        normalizedQuote.company_id,
        'offer',
        quoteId,
      )
      communicationFeed = communication.feedItems
    } catch (error) {
      console.error('[EMAIL] Failed to load quote communication feed', error)
    }
  }

  const versionRows =
    normalizedQuote.source_calculation_id && !calculationVersionsError
      ? ((calculationVersions ?? []) as CalculationVersionRow[])
      : []
  const sectionViewCounts = offerEvents.reduce<Record<string, number>>((accumulator, event) => {
    if (event.event_type !== 'section_viewed' && event.event_type !== 'pricing_viewed') {
      return accumulator
    }

    const key = event.section_key ?? (event.event_type === 'pricing_viewed' ? 'pricing' : 'unknown')
    accumulator[key] = (accumulator[key] ?? 0) + 1
    return accumulator
  }, {})

  const topSections = Object.entries(sectionViewCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)

  const uniqueVisitors = new Set(
    offerEvents.map((event) => event.visitor_id).filter((value): value is string => Boolean(value)),
  ).size

  return (
    <DashboardShell activeItem="quotes">
      <main style={pageShellStyle}>
        <SecondaryAction href={`/customers/${quoteCustomerId}/quotes`}>
          {dictionary.customers.quoteDetail.backToQuotes}
        </SecondaryAction>

        <section
          style={heroCardStyle}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
              marginBottom: '16px',
            }}
          >
            <div>
              <div style={eyebrowStyle}>
                {normalizedQuote.quote_number}
              </div>
              <h1 style={heroTitleStyle}>{normalizedQuote.title}</h1>
              <div style={heroTextStyle}>
                {customer?.name || dictionary.customers.quoteDetail.customerFallback}
              </div>
            </div>

            <div style={{ display: 'grid', gap: '12px', justifyItems: 'end' }}>
              <div
                style={{
                  ...getQuoteStatusStyle(resolvedStatus),
                  display: 'inline-block',
                  height: 'fit-content',
                  padding: '8px 12px',
                  borderRadius: '999px',
                  fontSize: '14px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {getQuoteStatusLabel(resolvedStatus)}
              </div>

              <QuoteActionsPanel
                customerId={quoteCustomerId}
                quoteId={quoteId}
                companyId={normalizedQuote.company_id}
                shareUrl={shareUrl}
                contactName={normalizedQuote.contact_name}
                contactEmail={normalizedQuote.contact_email}
                quoteTitle={normalizedQuote.title}
                sourceCalculationId={normalizedQuote.source_calculation_id}
                discountAmount={normalizedQuote.discount_amount}
                currentStatus={normalizedQuote.status}
                totalPrice={normalizedQuote.total_price}
                workDescription={normalizedQuote.work_description}
                proposedSolution={normalizedQuote.proposed_solution}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '14px',
              marginBottom: '16px',
            }}
          >
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.date}
              </div>
              <strong>{formatDate(normalizedQuote.quote_date)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.validUntil}
              </div>
              <strong>{formatDate(normalizedQuote.valid_until)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.subtotal}
              </div>
              <strong>{formatCurrency(normalizedQuote.subtotal_price)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.totalPrice}
              </div>
              <strong>{formatCurrency(normalizedQuote.total_price)}</strong>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <strong>{dictionary.customers.quoteDetail.contactPerson}:</strong>{' '}
              {normalizedQuote.contact_name || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.contactEmail}:</strong>{' '}
              {normalizedQuote.contact_email || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.discount}:</strong>{' '}
              {formatCurrency(normalizedQuote.discount_amount)}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.customerNote}:</strong>{' '}
              {normalizedQuote.customer_note || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.internalNote}:</strong>{' '}
              {normalizedQuote.internal_note || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.sharedLink}:</strong>{' '}
              {shareUrl ? (
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'none' }}
                >
                  {shareUrl}
                </a>
              ) : (
                '-'
              )}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.sentAt}:</strong>{' '}
              {formatDateTime(normalizedQuote.sent_at)}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.sourceCalculation}:</strong>{' '}
              {normalizedQuote.source_calculation_id ? (
                <Link
                  href={`/customers/${quoteCustomerId}/calculations/${normalizedQuote.source_calculation_id}`}
                  style={{ color: '#2563eb', textDecoration: 'none' }}
                >
                  {dictionary.customers.quoteDetail.openCalculation}
                </Link>
              ) : (
                '-'
              )}
            </div>
          </div>
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '24px' }}>
            {dictionary.customers.quoteDetail.quoteText}
          </h2>

          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <strong>{dictionary.customers.quoteDetail.intro}:</strong>{' '}
              {normalizedQuote.intro_text || '-'}
            </div>
            <div>
              <strong>
                {normalizedQuote.customer_request_title ||
                  dictionary.customers.quoteDetail.defaultCustomerRequestTitle}
                :
              </strong>{' '}
              {normalizedQuote.customer_request || '-'}
            </div>
            <div>
              <strong>
                {normalizedQuote.our_solution_title ||
                  dictionary.customers.quoteDetail.defaultOurSolutionTitle}
                :
              </strong>{' '}
              {normalizedQuote.proposed_solution || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.quoteDetail.importantInfo}:</strong>{' '}
              {normalizedQuote.work_description || '-'}
            </div>
            <div>
              <strong>
                {normalizedQuote.timeline_title ||
                  dictionary.customers.quoteDetail.defaultTimelineTitle}
                :
              </strong>{' '}
              {normalizedQuote.work_schedule || '-'}
            </div>
            <div>
              <strong>
                {normalizedQuote.pricing_title ||
                  dictionary.customers.quoteDetail.defaultPricingTitle}
                :
              </strong>{' '}
              {normalizedQuote.pricing_text || '-'}
            </div>
            <div>
              <strong>
                {normalizedQuote.payment_terms_title ||
                  dictionary.customers.quoteDetail.defaultPaymentTermsTitle}
                :
              </strong>{' '}
              {normalizedQuote.payment_terms || dictionary.customers.quoteDetail.defaultPaymentTerms}
            </div>
          </div>
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '24px' }}>
            {dictionary.customers.quoteDetail.items}
          </h2>

          {quoteItemsError ? (
            <p style={{ color: '#b91c1c' }}>
              {dictionary.customers.quoteDetail.itemsLoadFailed}: {quoteItemsError.message}
            </p>
          ) : quoteItems.length === 0 ? (
            <p style={{ color: '#6b7280' }}>{dictionary.customers.quoteDetail.noItems}</p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {quoteItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '14px',
                    backgroundColor: '#f9fafb',
                    padding: '16px',
                    display: 'grid',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '18px', fontWeight: 700 }}>{item.name}</div>
                  {item.description && <div style={{ color: '#4b5563' }}>{item.description}</div>}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <strong>{dictionary.customers.quoteDetail.quantity}:</strong>{' '}
                      {Number(item.quantity ?? 0)}
                    </div>
                    <div>
                      <strong>{dictionary.customers.quoteDetail.unit}:</strong> {item.unit || '-'}
                    </div>
                    <div>
                      <strong>{dictionary.customers.quoteDetail.pricePerUnit}:</strong>{' '}
                      {formatCurrency(item.unit_price)}
                    </div>
                    <div>
                      <strong>{dictionary.customers.quoteDetail.itemTotal}:</strong>{' '}
                      {formatCurrency(item.total_price)}
                    </div>
                  </div>
                  <div>
                    <strong>{dictionary.customers.quoteDetail.note}:</strong> {item.note || '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '24px' }}>
            {dictionary.customers.quoteDetail.responses}
          </h2>

          {responsesError ? (
            <p style={{ color: '#b91c1c' }}>
              {dictionary.customers.quoteDetail.responsesLoadFailed}: {responsesError.message}
            </p>
          ) : offerResponses.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>
              {dictionary.customers.quoteDetail.noResponses}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {offerResponses.map((response) => (
                <div
                  key={response.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '14px',
                    backgroundColor: '#f9fafb',
                    padding: '16px',
                    display: 'grid',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: '18px' }}>{response.customer_name}</strong>
                      <span
                        style={{
                          ...getOfferResponseStyle(response.action_type),
                          display: 'inline-block',
                          padding: '6px 10px',
                          borderRadius: '999px',
                          fontSize: '13px',
                          fontWeight: 700,
                        }}
                      >
                        {getOfferResponseLabel(response.action_type, dictionary)}
                      </span>
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '14px' }}>
                      {formatDateTime(response.created_at)}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '4px', color: '#334155' }}>
                    <div>
                      <strong>{dictionary.customers.quoteDetail.email}:</strong>{' '}
                      {response.customer_email}
                    </div>
                    <div>
                      <strong>{dictionary.customers.quoteDetail.phone}:</strong>{' '}
                      {response.customer_phone}
                    </div>
                    {response.note?.trim() ? (
                      <div>
                        <strong>{dictionary.customers.quoteDetail.note}:</strong> {response.note}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '24px' }}>
            {dictionary.customers.quoteDetail.analytics}
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '14px',
              marginBottom: '18px',
            }}
          >
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.views}
              </div>
              <strong>{Number(normalizedQuote.view_count ?? 0)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.firstOpened}
              </div>
              <strong>{formatDateTime(normalizedQuote.first_viewed_at)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.lastOpened}
              </div>
              <strong>{formatDateTime(normalizedQuote.last_viewed_at)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>
                {dictionary.customers.quoteDetail.uniqueVisitors}
              </div>
              <strong>{uniqueVisitors}</strong>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '18px' }}>
                {dictionary.customers.quoteDetail.topSections}
              </h3>
              {topSections.length === 0 ? (
                <p style={{ margin: 0, color: '#6b7280' }}>
                  {dictionary.customers.quoteDetail.noSectionData}
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {topSections.map(([sectionKey, count]) => (
                    <div
                      key={sectionKey}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
                    >
                      <span>{getSectionLabel(sectionKey, normalizedQuote, dictionary)}</span>
                      <strong>{count}x</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '18px' }}>
                {dictionary.customers.quoteDetail.latestActions}
              </h3>
              {eventsError ? (
                <p style={{ margin: 0, color: '#b91c1c' }}>
                  {dictionary.customers.quoteDetail.eventsLoadFailed}: {eventsError.message}
                </p>
              ) : offerEvents.length === 0 ? (
                <p style={{ margin: 0, color: '#6b7280' }}>
                  {dictionary.customers.quoteDetail.noInteractions}
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {offerEvents.slice(0, 6).map((event) => (
                    <div key={event.id} style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '10px' }}>
                      <div style={{ fontWeight: 700 }}>{getEventLabel(event.event_type, dictionary)}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        {formatDateTime(event.created_at)}
                      </div>
                      <div style={{ fontSize: '14px', color: '#334155', marginTop: '4px' }}>
                        {event.section_key
                          ? `${dictionary.customers.quoteDetail.sectionPrefix}: ${getSectionLabel(event.section_key, normalizedQuote, dictionary)}`
                          : dictionary.customers.quoteDetail.wholeOffer}
                        {event.event_value
                          ? ` - ${dictionary.customers.quoteDetail.valuePrefix}: ${event.event_value}`
                          : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <EntityCommunicationTimeline
          entityType="offer"
          entityId={quoteId}
          title="E-mailová komunikace k nabídce"
          description="Uložené odeslané i přijaté emaily navázané na tuto cenovou nabídku."
          emptyLabel="U této nabídky zatím není žádná uložená emailová komunikace."
          feedItems={communicationFeed}
        />

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
            marginTop: '20px',
          }}
        >
          <details
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '14px',
              backgroundColor: '#f9fafb',
              overflow: 'hidden',
            }}
          >
            <summary
              style={{
                listStyle: 'none',
                cursor: 'pointer',
                padding: '16px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
                fontWeight: 700,
              }}
            >
              <span>{dictionary.customers.quoteDetail.chronologicalLog}</span>
              <span style={{ color: '#6b7280', fontSize: '14px', fontWeight: 600 }}>
                {offerEvents.length} {dictionary.customers.quoteDetail.records}
              </span>
            </summary>

            <div style={{ padding: '0 18px 18px' }}>
              {eventsError ? (
                <p style={{ color: '#b91c1c' }}>
                  {dictionary.customers.quoteDetail.eventsLoadFailed}: {eventsError.message}
                </p>
              ) : offerEvents.length === 0 ? (
                <p style={{ color: '#6b7280' }}>{dictionary.customers.quoteDetail.noEvents}</p>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {offerEvents.map((event) => (
                    <details
                      key={event.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: '14px',
                        backgroundColor: '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <summary
                        style={{
                          listStyle: 'none',
                          cursor: 'pointer',
                          padding: '14px 16px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '12px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <strong>{getEventLabel(event.event_type, dictionary)}</strong>
                          <span style={{ color: '#6b7280' }}>{formatDateTime(event.created_at)}</span>
                        </div>
                        <div style={{ marginTop: '6px', color: '#6b7280', fontSize: '14px' }}>
                          {event.section_key
                            ? `${dictionary.customers.quoteDetail.sectionPrefix}: ${getSectionLabel(event.section_key, normalizedQuote, dictionary)}`
                            : dictionary.customers.quoteDetail.wholeOffer}
                        </div>
                      </summary>

                      <div
                        style={{
                          padding: '0 16px 16px',
                          color: '#334155',
                          display: 'grid',
                          gap: '4px',
                        }}
                      >
                        <div>
                          <strong>{dictionary.customers.quoteDetail.section}:</strong>{' '}
                          {getSectionLabel(event.section_key, normalizedQuote, dictionary)}
                        </div>
                        <div>
                          <strong>{dictionary.customers.quoteDetail.visitor}:</strong>{' '}
                          {event.visitor_id || '-'}
                        </div>
                        <div>
                          <strong>{dictionary.customers.quoteDetail.device}:</strong>{' '}
                          {event.device_type || '-'}
                        </div>
                        <div>
                          <strong>{dictionary.customers.quoteDetail.referrer}:</strong>{' '}
                          {event.referrer || '-'}
                        </div>
                        {event.event_value ? (
                          <div>
                            <strong>{dictionary.customers.quoteDetail.value}:</strong>{' '}
                            {event.event_value}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </details>
        </section>

        {normalizedQuote.source_calculation_id ? (
          <section
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '16px',
              backgroundColor: '#ffffff',
              padding: '24px',
              marginTop: '20px',
            }}
          >
            <details
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '14px',
                backgroundColor: '#f9fafb',
                overflow: 'hidden',
              }}
            >
              <summary
                style={{
                  listStyle: 'none',
                  cursor: 'pointer',
                  padding: '16px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  fontWeight: 700,
                }}
              >
                <span>{dictionary.customers.quoteDetail.versionHistory}</span>
                <span style={{ color: '#6b7280', fontSize: '14px', fontWeight: 600 }}>
                  {calculationVersionsError
                    ? dictionary.customers.quoteDetail.loadVersionsFailed
                    : `${versionRows.length} ${dictionary.customers.quoteDetail.versions}`}
                </span>
              </summary>

              <div style={{ padding: '0 18px 18px' }}>
                {calculationVersionsError ? (
                  <p style={{ color: '#b91c1c' }}>
                    {dictionary.customers.quoteDetail.loadVersionsFailed}:{' '}
                    {calculationVersionsError.message}
                  </p>
                ) : versionRows.length === 0 ? (
                  <p style={{ color: '#6b7280' }}>{dictionary.customers.quoteDetail.noVersions}</p>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {versionRows.map((version) => (
                      <div
                        key={version.id}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: '14px',
                          backgroundColor: '#ffffff',
                          padding: '14px 16px',
                          display: 'grid',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '12px',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          <strong style={{ fontSize: '18px' }}>
                            {dictionary.customers.quoteDetail.version} {version.version_number}
                          </strong>
                          <span style={{ color: '#6b7280', fontSize: '14px' }}>
                            {dictionary.customers.quoteDetail.savedAt}: {formatDateTime(version.saved_at)}
                          </span>
                        </div>

                        <div>
                          <strong>{dictionary.jobs.titleLabel}:</strong> {version.title}
                        </div>
                        <div>
                          <strong>{dictionary.customers.quoteDetail.calculationStatus}:</strong>{' '}
                          {version.status || '-'}
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                            gap: '12px',
                          }}
                        >
                          <div>
                            <strong>{dictionary.customers.quoteDetail.costs}:</strong>{' '}
                            {formatCurrency(version.subtotal_cost)}
                          </div>
                          <div>
                            <strong>{dictionary.customers.quoteDetail.subtotal}:</strong>{' '}
                            {formatCurrency(version.subtotal_price)}
                          </div>
                          <div>
                            <strong>{dictionary.customers.quoteDetail.totalPrice}:</strong>{' '}
                            {formatCurrency(version.total_price)}
                          </div>
                        </div>
                        <div>
                          <Link
                            href={`/customers/${quoteCustomerId}/calculations/${version.calculation_id}`}
                            style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {dictionary.customers.quoteDetail.openCurrentCalculation}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </section>
        ) : null}
      </main>
    </DashboardShell>
  )
}
