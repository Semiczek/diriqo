import { NextRequest, NextResponse } from 'next/server'
import {
  isAllowedResponseActionType,
  parsePublicOfferResponseContact,
  isLikelyPublicOfferToken,
  MAX_HONEYPOT_LENGTH,
  MAX_REFERRER_LENGTH,
  MAX_USER_AGENT_LENGTH,
  normalizeOptionalText,
  normalizeReferrer,
  normalizeVisitorId,
} from '@/lib/public-offer-security'
import { coreQuoteId } from '@/lib/core-quote-lifecycle'
import { createSupabasePublicClient } from '@/lib/supabase-public'

type RespondPayload = {
  versionId?: string
  operationId?: string
  token?: string
  actionType?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  note?: string | null
  visitorId?: string | null
  website?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    const contentLength = Number(request.headers.get('content-length') || '0')

    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json({ ok: false, error: 'Invalid content type' }, { status: 400 })
    }

    if (Number.isFinite(contentLength) && contentLength > 8_192) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
    }

    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 8_192) return NextResponse.json({ ok: false }, { status: 413 })
    const body = JSON.parse(raw) as RespondPayload
    const token = body.token?.trim() || ''
    const actionType = body.actionType?.trim() || ''
    let contact: ReturnType<typeof parsePublicOfferResponseContact>
    try { contact = parsePublicOfferResponseContact(body) }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Zkontrolujte údaje.' }, { status: 400 }) }
    const { customerName, customerEmail, customerPhone, note } = contact
    const visitorId = normalizeVisitorId(body.visitorId)
    const honeypot = normalizeOptionalText(body.website, MAX_HONEYPOT_LENGTH)

    if (honeypot) {
      return NextResponse.json({ ok: true }, { status: 202 })
    }

    if (!isLikelyPublicOfferToken(token) || !isAllowedResponseActionType(actionType)) {
      return NextResponse.json({ ok: false, error: 'Neplatna akce nabidky.' }, { status: 400 })
    }

    const versionId = coreQuoteId(body.versionId)
    const operationId = coreQuoteId(body.operationId)
    const supabase = createSupabasePublicClient()
    const userAgent = normalizeOptionalText(request.headers.get('user-agent'), MAX_USER_AGENT_LENGTH)
    const referrer = normalizeReferrer(
      normalizeOptionalText(request.headers.get('referer'), MAX_REFERRER_LENGTH),
    )

    const { data, error } = await supabase.rpc('respond_public_core_quote_version', {
      input_token: token,
      p_operation_id: operationId,
      p_input: { version_id: versionId, action_type: actionType, customer_name: customerName,
        customer_email: customerEmail, customer_phone: customerPhone, note, visitor_id: visitorId,
        user_agent: userAgent, referrer },
    })

    if (error) {
      return NextResponse.json({ ok: false, error: 'Reakci se nepodařilo potvrdit. Ověřte platnost odkazu a opakujte stejný požadavek.' }, { status: 409 })
    }

    const response = Array.isArray(data) ? data[0] : data

    if (!response?.success || response.versionId !== versionId || response.operationId !== operationId) {
    return NextResponse.json({ ok: false, error: 'Reakci se nepodařilo uložit.' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      versionId, operationId, responseId: response.responseId ?? null,
    })
  } catch {
    const message = 'Reakci se nepodařilo potvrdit. Zkontrolujte údaje a opakujte stejný požadavek.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
