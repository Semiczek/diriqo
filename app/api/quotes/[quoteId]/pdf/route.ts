import { NextRequest, NextResponse } from 'next/server'
import { requireHubAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { coreQuoteId, coreQuoteRevision, parseCoreQuoteDocumentRead } from '@/lib/core-quote-lifecycle'
import { buildCoreQuotePdf } from '@/lib/core-quote-pdf'

export const runtime = 'nodejs'
export async function GET(request: NextRequest, context: { params: Promise<{ quoteId: string }> }) {
  const access = await requireHubAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const { quoteId } = await context.params
    coreQuoteId(quoteId)
    const versionId = request.nextUrl.searchParams.get('versionId')
    const draftRevision = request.nextUrl.searchParams.get('draftRevision')
    const legacy = request.nextUrl.searchParams.get('legacy') === '1'
    if ([Boolean(versionId), Boolean(draftRevision), legacy].filter(Boolean).length !== 1) {
      return NextResponse.json({ error: 'Vyberte konkrétní verzi nebo koncept nabídky v jejím detailu.' }, { status: 400 })
    }
    const supabase = await createSupabaseServerClient()
    const args = { p_company_id: access.value.companyId, p_quote_id: quoteId }
    const { data, error } = draftRevision
      ? await supabase.rpc('get_core_quote_draft_document', { ...args, p_expected_revision: coreQuoteRevision(draftRevision) })
      : await supabase.rpc('get_core_quote_version', { ...args, p_version_id: versionId ? coreQuoteId(versionId) : null })
    if (error || !data) return NextResponse.json({ error: 'Tato verze nabídky není v aktivní firmě dostupná.' }, { status: 404 })
    const read = parseCoreQuoteDocumentRead(data)
    if (read.document.quote_id !== quoteId || (versionId && read.document.version_id !== versionId)
      || (draftRevision && read.kind !== 'draft') || (legacy && read.kind !== 'legacy')) {
      return NextResponse.json({ error: 'Nepodařilo se ověřit požadovanou verzi nabídky.' }, { status: 409 })
    }
    const fileNumber = read.document.quote_number?.replace(/[^\w-]/g, '') || 'nabidka'
    return new NextResponse(new Uint8Array(buildCoreQuotePdf(read.document, read)), { headers: {
      'content-type': 'application/pdf', 'content-disposition': `attachment; filename="cenova-nabidka-${fileNumber}.pdf"`,
      'cache-control': 'private, no-store',
    } })
  } catch {
    return NextResponse.json({ error: 'Nabídku se nepodařilo bezpečně načíst pro export.' }, { status: 400 })
  }
}
