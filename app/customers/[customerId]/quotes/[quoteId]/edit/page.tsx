import Link from 'next/link'
import QuoteEditForm from '@/components/QuoteEditForm'
import type { CSSProperties } from 'react'
import DashboardShell from '@/components/DashboardShell'
import { pageShellStyle } from '@/components/SaasPageLayout'
import { getRequestDictionary } from '@/lib/i18n/server'
import { QuoteStatus, getQuoteStatusLabel, getQuoteStatusStyle, resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
    quoteId: string
  }>
}

const editPageShellStyle: CSSProperties = {
  ...pageShellStyle,
  gap: '12px',
  maxWidth: '1180px',
}

const backLinkStyle: CSSProperties = {
  justifySelf: 'start',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '36px',
  padding: '8px 12px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 820,
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.04)',
}

const editHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'stretch',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '18px 20px',
  borderRadius: '20px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background:
    'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 52%, rgba(236,254,255,0.9) 100%)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
}

const editHeaderMainStyle: CSSProperties = {
  flex: '1 1 420px',
  minWidth: 0,
}

const editEyebrowStyle: CSSProperties = {
  display: 'inline-flex',
  width: 'fit-content',
  marginBottom: '9px',
  padding: '4px 9px',
  borderRadius: '999px',
  border: '1px solid rgba(124, 58, 237, 0.22)',
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
  color: '#5b21b6',
  fontSize: '12px',
  fontWeight: 900,
}

const editTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '34px',
  lineHeight: 1.08,
  fontWeight: 900,
}

const editSubtitleStyle: CSSProperties = {
  marginTop: '8px',
  color: '#475569',
  fontSize: '14px',
  lineHeight: 1.4,
  fontWeight: 650,
}

const editSummaryStyle: CSSProperties = {
  flex: '0 1 380px',
  minWidth: 'min(100%, 300px)',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px',
  alignContent: 'start',
  padding: '12px',
  borderRadius: '16px',
  border: '1px solid rgba(226, 232, 240, 0.88)',
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
}

const editSummaryItemStyle: CSSProperties = {
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: '12px',
  border: '1px solid rgba(226, 232, 240, 0.92)',
  backgroundColor: '#ffffff',
}

const editSummaryLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '2px',
  color: '#64748b',
  fontSize: '11px',
  fontWeight: 820,
}

const editSummaryValueStyle: CSSProperties = {
  display: 'block',
  overflowWrap: 'anywhere',
  color: '#0f172a',
  fontSize: '13px',
  fontWeight: 880,
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

export default async function QuoteEditPage({ params }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId, quoteId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(
      'id, title, status, quote_date, valid_until, share_token, sent_at, accepted_at, rejected_at'
    )
    .eq('id', quoteId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error || !quote) {
    return (
      <DashboardShell activeItem="quotes">
        <main style={editPageShellStyle}>
          <p>{dictionary.customers.quoteEditPage.notFound}</p>
        </main>
      </DashboardShell>
    )
  }
  const quoteWithOptionalNotes = quote as typeof quote & {
    customer_note?: string | null
    internal_note?: string | null
    discount_amount?: number | string | null
    contact_name?: string | null
    contact_email?: string | null
    intro_text?: string | null
    customer_request_title?: string | null
    customer_request?: string | null
    our_solution_title?: string | null
    proposed_solution?: string | null
    benefits_text?: string | null
    timeline_title?: string | null
    work_description?: string | null
    work_schedule?: string | null
    pricing_title?: string | null
    pricing_text?: string | null
    payment_terms_title?: string | null
    payment_terms?: string | null
  }
  const resolvedStatus = resolveQuoteStatus(quote.status, quote.valid_until) as QuoteStatus

  return (
    <DashboardShell activeItem="quotes">
      <main style={editPageShellStyle}>
        <Link href={`/customers/${customerId}/quotes/${quoteId}`} style={backLinkStyle}>
          {dictionary.customers.quoteEditPage.backToQuote}
        </Link>

        <section style={editHeaderStyle}>
          <div style={editHeaderMainStyle}>
            <div style={editEyebrowStyle}>Úprava nabídky</div>
            <h1 style={editTitleStyle}>{dictionary.customers.quoteEditPage.title}</h1>
            <div style={editSubtitleStyle}>{quote.title}</div>
          </div>

          <aside style={editSummaryStyle}>
            <div
              style={{
                ...getQuoteStatusStyle(resolvedStatus),
                display: 'inline-flex',
                gridColumn: '1 / -1',
                width: 'fit-content',
                padding: '5px 9px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 850,
              }}
            >
              {getQuoteStatusLabel(resolvedStatus)}
            </div>
            <div style={editSummaryItemStyle}>
              <span style={editSummaryLabelStyle}>{dictionary.customers.quoteForm.date}</span>
              <strong style={editSummaryValueStyle}>{formatDate(quote.quote_date)}</strong>
            </div>
            <div style={editSummaryItemStyle}>
              <span style={editSummaryLabelStyle}>{dictionary.customers.quoteForm.validUntil}</span>
              <strong style={editSummaryValueStyle}>{formatDate(quote.valid_until)}</strong>
            </div>
          </aside>
        </section>

        <QuoteEditForm
          customerId={customerId}
          quoteId={quoteId}
          initialValues={{
            title: quote.title,
            status: resolvedStatus,
            quoteDate: quote.quote_date ?? '',
            validUntil: quote.valid_until ?? '',
            discountAmount: quoteWithOptionalNotes.discount_amount != null ? String(quoteWithOptionalNotes.discount_amount) : '0',
            shareToken: quote.share_token ?? '',
            contactName: quoteWithOptionalNotes.contact_name ?? '',
            contactEmail: quoteWithOptionalNotes.contact_email ?? '',
            introText: quoteWithOptionalNotes.intro_text ?? '',
            customerRequestTitle: quoteWithOptionalNotes.customer_request_title ?? dictionary.customers.quoteDetail.defaultCustomerRequestTitle,
            customerNote: quoteWithOptionalNotes.customer_note ?? '',
            internalNote: quoteWithOptionalNotes.internal_note ?? '',
            customerRequest: quoteWithOptionalNotes.customer_request ?? '',
            ourSolutionTitle: quoteWithOptionalNotes.our_solution_title ?? dictionary.customers.quoteDetail.defaultOurSolutionTitle,
            proposedSolution: quoteWithOptionalNotes.proposed_solution ?? '',
            benefitsText: quoteWithOptionalNotes.benefits_text ?? '',
            timelineTitle: quoteWithOptionalNotes.timeline_title ?? dictionary.customers.quoteDetail.defaultTimelineTitle,
            workDescription: quoteWithOptionalNotes.work_description ?? '',
            workSchedule: quoteWithOptionalNotes.work_schedule ?? '',
            pricingTitle: quoteWithOptionalNotes.pricing_title ?? dictionary.customers.quoteDetail.defaultPricingTitle,
            pricingText: quoteWithOptionalNotes.pricing_text ?? '',
            paymentTermsTitle: quoteWithOptionalNotes.payment_terms_title ?? dictionary.customers.quoteDetail.defaultPaymentTermsTitle,
            paymentTerms: quoteWithOptionalNotes.payment_terms ?? dictionary.customers.quoteDetail.defaultPaymentTerms,
            sentAt: quote.sent_at ?? '',
            acceptedAt: quote.accepted_at ?? '',
            rejectedAt: quote.rejected_at ?? '',
          }}
        />
      </main>
    </DashboardShell>
  )
}
