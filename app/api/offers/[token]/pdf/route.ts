import { NextRequest, NextResponse } from 'next/server'
import { getPublicCoreQuote } from '@/lib/dal/core-quote-customer-read'
import { buildCoreQuotePdf } from '@/lib/core-quote-pdf'

export const runtime = 'nodejs'
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const read = await getPublicCoreQuote(token)
  if (!read) return NextResponse.json({ error: 'Nabídka není dostupná.' }, { status: 404 })
  const fileNumber = read.document.quote_number?.replace(/[^\w-]/g, '') || 'nabidka'
  return new NextResponse(new Uint8Array(buildCoreQuotePdf(read.document, read)), { headers: {
    'content-type': 'application/pdf', 'content-disposition': `attachment; filename="cenova-nabidka-${fileNumber}.pdf"`,
    'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer',
  } })
}
