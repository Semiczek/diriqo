import QuoteDetailPage from '@/app/customers/[customerId]/quotes/[quoteId]/page'
type Props = { params: Promise<{ quoteId: string }>; searchParams?: Promise<{ version?: string }> }
export default async function GlobalQuoteDetailPage({ params, searchParams }: Props) {
  const { quoteId } = await params
  return QuoteDetailPage({ params: Promise.resolve({ customerId: '', quoteId }), searchParams })
}
