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
      'id, title, status, quote_date, valid_until, discount_amount, share_token, contact_name, contact_email, intro_text, customer_request_title, customer_note, internal_note, customer_request, our_solution_title, proposed_solution, benefits_text, timeline_title, work_description, work_schedule, pricing_title, pricing_text, payment_terms_title, payment_terms, sent_at, accepted_at, rejected_at'
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
            discountAmount: quote.discount_amount != null ? String(quote.discount_amount) : '0',
            shareToken: quote.share_token ?? '',
            contactName: quote.contact_name ?? '',
            contactEmail: quote.contact_email ?? '',
            introText: quote.intro_text ?? '',
            customerRequestTitle: quote.customer_request_title ?? dictionary.customers.quoteDetail.defaultCustomerRequestTitle,
            customerNote: quote.customer_note ?? '',
            internalNote: quote.internal_note ?? '',
            customerRequest: quote.customer_request ?? '',
            ourSolutionTitle: quote.our_solution_title ?? dictionary.customers.quoteDetail.defaultOurSolutionTitle,
            proposedSolution: quote.proposed_solution ?? '',
            benefitsText: quote.benefits_text ?? '',
            timelineTitle: quote.timeline_title ?? dictionary.customers.quoteDetail.defaultTimelineTitle,
            workDescription: quote.work_description ?? '',
            workSchedule: quote.work_schedule ?? '',
            pricingTitle: quote.pricing_title ?? dictionary.customers.quoteDetail.defaultPricingTitle,
            pricingText: quote.pricing_text ?? '',
            paymentTermsTitle: quote.payment_terms_title ?? dictionary.customers.quoteDetail.defaultPaymentTermsTitle,
            paymentTerms: quote.payment_terms ?? dictionary.customers.quoteDetail.defaultPaymentTerms,
            sentAt: quote.sent_at ?? '',
            acceptedAt: quote.accepted_at ?? '',
            rejectedAt: quote.rejected_at ?? '',
          }}
        />
      </main>
    </DashboardShell>
  )
}
