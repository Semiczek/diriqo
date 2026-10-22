import type { PublicOfferPageProps } from '@/components/public-offer/types'
import type { CoreQuoteDocumentRead } from './core-quote-lifecycle'

/** Build customer UI props explicitly. Never spread a database/workspace object into a client. */
export function coreQuotePresentation(read: CoreQuoteDocumentRead, token: string, context: 'public' | 'portal', pdfHref: string | null): PublicOfferPageProps {
  const d = read.document
  const c = d.content
  return {
    token, context, versionId: d.version_id, versionNumber: d.version_number,
    canRespond: read.kind === 'issued' && !['accepted', 'rejected', 'expired', 'revoked', 'archived'].includes(read.status || ''),
    title: d.title || 'Cenová nabídka', customerName: d.customer?.billing_name || d.customer?.name || null,
    validUntil: d.valid_until, benefitsText: c.benefits_text,
    contactName: c.contact_name, contactEmail: c.contact_email,
    companyName: d.supplier.name, companyLogoUrl: d.supplier.logo_url,
    priceTotal: d.total_price == null ? null : Number(d.total_price), currency: d.currency, pricingMode: d.pricing_mode,
    subtotal: d.subtotal_price == null ? null : Number(d.subtotal_price), discount: d.discount_amount == null ? null : Number(d.discount_amount),
    pricingTitle: c.pricing_title || 'Cena a rozsah nabídky', pricingText: c.pricing_text,
    preparedByName: c.contact_name, preparedAt: read.publishedAt, updatedAt: null, pdfHref,
    sections: [
      { key: 'intro', title: 'Úvod', content: c.intro_text },
      { key: 'customer_request', title: c.customer_request_title || 'Zadání zákazníka', content: c.customer_request },
      { key: 'our_solution', title: c.our_solution_title || 'Navržené řešení', content: c.proposed_solution },
      { key: 'work_description', title: 'Rozsah prací', content: c.work_description },
      { key: 'timeline', title: c.timeline_title || 'Termín a organizace', content: c.work_schedule },
      { key: 'payment_terms', title: c.payment_terms_title || 'Platební podmínky', content: c.payment_terms },
      { key: 'customer_note', title: 'Poznámka pro zákazníka', content: d.customer_note },
    ],
    items: d.items.map(item => ({
      id: item.id, name: item.name || 'Položka', description: item.description,
      quantity: Number(item.quantity), unit: item.unit, unitPrice: Number(item.unit_price),
      totalPrice: item.total_price == null ? null : Number(item.total_price), vatRate: item.vat_rate == null ? null : Number(item.vat_rate), note: item.note,
    })),
  }
}
