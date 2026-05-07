import Link from 'next/link'
import QuoteEditForm from '@/components/QuoteEditForm'
import DashboardShell from '@/components/DashboardShell'
import {
  SecondaryAction,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTitleStyle,
  pageShellStyle,
} from '@/components/SaasPageLayout'
import { getRequestDictionary } from '@/lib/i18n/server'
import { QuoteStatus, resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
    quoteId: string
  }>
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
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
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

  return (
    <DashboardShell activeItem="customers">
      <main
        style={pageShellStyle}
      >
        <SecondaryAction href={`/customers/${customerId}/quotes/${quoteId}`}>
          {dictionary.customers.quoteEditPage.backToQuote}
        </SecondaryAction>

        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Úprava nabídky</div>
            <h1 style={heroTitleStyle}>{dictionary.customers.quoteEditPage.title}</h1>
          </div>
        </section>

        <QuoteEditForm
          customerId={customerId}
          quoteId={quoteId}
          initialValues={{
            title: quote.title,
            status: resolveQuoteStatus(quote.status, quote.valid_until) as QuoteStatus,
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
