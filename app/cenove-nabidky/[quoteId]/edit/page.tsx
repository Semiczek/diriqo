import QuoteEditPage from '@/app/customers/[customerId]/quotes/[quoteId]/edit/page'
type Props = { params: Promise<{ quoteId: string }> }
export default async function GlobalQuoteEditPage({ params }: Props) {
  const { quoteId } = await params
  return QuoteEditPage({ params: Promise.resolve({ customerId: '', quoteId }) })
}
