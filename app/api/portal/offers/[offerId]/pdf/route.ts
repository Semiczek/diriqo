import { NextRequest, NextResponse } from 'next/server'
import { getPortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalCoreQuote, parsePortalQuoteSelector } from '@/lib/dal/core-quote-customer-read'
import { buildCoreQuotePdf } from '@/lib/core-quote-pdf'
export const runtime = 'nodejs'
export async function GET(request: NextRequest, context: { params: Promise<{ offerId: string }> }) {
  const portalUser = await getPortalUserContext()
  if (!portalUser?.companyId) return NextResponse.json({ error: 'Přihlaste se do portálu.' }, { status: 401 })
  const { offerId } = await context.params
  let versionId: string | null
  try {
    const versions = request.nextUrl.searchParams.getAll('versionId'), legacy = request.nextUrl.searchParams.getAll('legacy')
    versionId = parsePortalQuoteSelector({
      versionId: versions.length === 0 ? undefined : versions.length === 1 ? versions[0] : versions,
      legacy: legacy.length === 0 ? undefined : legacy.length === 1 ? legacy[0] : legacy,
    })
  } catch { return NextResponse.json({ error: 'Vyberte právě jednu vydanou verzi nebo starší nabídku.' }, { status: 400 }) }
  try {
    const read = await getPortalCoreQuote(portalUser.companyId, portalUser.customerId, offerId, versionId)
    if (!read) return NextResponse.json({ error: 'Nabídka není dostupná.' }, { status: 404 })
    return new NextResponse(new Uint8Array(buildCoreQuotePdf(read.document, read)), { headers: {
      'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="cenova-nabidka.pdf"', 'cache-control': 'private, no-store',
    } })
  } catch { return NextResponse.json({ error: 'Nabídka není dostupná.' }, { status: 404 }) }
}
