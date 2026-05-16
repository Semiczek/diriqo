import QuoteDetailPage from '@/app/customers/[customerId]/quotes/[quoteId]/page'

type PageProps = {
  params: Promise<{
    quoteId: string
  }>
}

export default async function GlobalQuoteDetailPage({ params }: PageProps) {
  const { quoteId } = await params

  return QuoteDetailPage({
    params: Promise.resolve({
      customerId: '',
      quoteId,
    }),
  })
}
