import { NextResponse } from 'next/server'
import { getPortalUserContext } from '@/lib/customer-portal/auth'
import { respondToPortalQuote } from '@/lib/dal/core-quote-portal-response'
export async function POST(request: Request) {
  const user = await getPortalUserContext()
  if (!user) return NextResponse.json({ ok: false, error: 'Přihlaste se do zákaznického portálu.' }, { status: 401 })
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ ok: false }, { status: 400 })
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > 8192) return NextResponse.json({ ok: false }, { status: 413 })
  try {
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.actionType !== 'string'
      || (body.note != null && typeof body.note !== 'string')) return NextResponse.json({ ok: false }, { status: 400 })
    const result = await respondToPortalQuote(user, { expectedPortalUserId: body.actorId, quoteId: body.offerId, versionId: body.versionId,
      operationId: body.operationId, actionType: body.actionType, note: body.note })
    return NextResponse.json({ ok: true, versionId: result.versionId, operationId: result.operationId, responseId: result.responseId })
  } catch {
    return NextResponse.json({ ok: false, error: 'Reakci se nepodařilo potvrdit. Ověřte platnost nabídky a opakujte stejný požadavek.' }, { status: 409 })
  }
}
