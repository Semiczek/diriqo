export type OfferItem = {
  id: string
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  totalPrice: number | null
  note: string | null
}

export type OfferSection = {
  key: string
  title: string
  content: string | null
}

export type PublicOfferPageProps = {
  token: string
  context?: 'public' | 'portal'
  title: string
  customerName: string | null
  defaultCustomerEmail?: string | null
  defaultCustomerPhone?: string | null
  validUntil: string | null
  benefitsText: string | null
  contactName: string | null
  contactEmail: string | null
  companyName?: string | null
  companyLogoUrl?: string | null
  priceTotal: number | null
  pricingTitle: string
  pricingText: string | null
  preparedByName: string | null
  preparedAt: string | null
  updatedAt: string | null
  pdfHref?: string | null
  sections: OfferSection[]
  items: OfferItem[]
}

export type CtaActionType =
  | 'interested'
  | 'contact_requested'
  | 'revision_requested'
  | 'not_interested'

export type CtaModalState = {
  actionType: CtaActionType
  title: string
  description: string
  submitLabel: string
  noteLabel: string
  notePlaceholder: string
}
