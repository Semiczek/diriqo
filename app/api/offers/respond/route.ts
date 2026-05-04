import { NextRequest, NextResponse } from 'next/server'
import {
  isAllowedResponseActionType,
  isLikelyPublicOfferToken,
  isValidCustomerEmail,
  isValidCustomerPhone,
  MAX_EMAIL_LENGTH,
  MAX_HONEYPOT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_REFERRER_LENGTH,
  MAX_USER_AGENT_LENGTH,
  normalizeOptionalText,
  normalizeReferrer,
  normalizeRequiredText,
  normalizeVisitorId,
} from '@/lib/public-offer-security'
import { createSupabasePublicClient } from '@/lib/supabase-public'

type RespondPayload = {
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

    const body = (await request.json()) as RespondPayload
    const token = body.token?.trim() || ''
    const actionType = body.actionType?.trim() || ''
    const customerName = normalizeRequiredText(body.customerName, MAX_NAME_LENGTH)
    const customerEmail = normalizeRequiredText(body.customerEmail, MAX_EMAIL_LENGTH)?.toLowerCase()
    const customerPhone = normalizeRequiredText(body.customerPhone, MAX_PHONE_LENGTH)
    const note = normalizeOptionalText(body.note, MAX_NOTE_LENGTH)
    const visitorId = normalizeVisitorId(body.visitorId)
    const honeypot = normalizeOptionalText(body.website, MAX_HONEYPOT_LENGTH)

    if (honeypot) {
      return NextResponse.json({ ok: true }, { status: 202 })
    }

    if (!isLikelyPublicOfferToken(token) || !isAllowedResponseActionType(actionType)) {
      return NextResponse.json({ ok: false, error: 'Neplatna akce nabidky.' }, { status: 400 })
    }

    if (!customerName || !customerEmail || !customerPhone) {
      return NextResponse.json({ ok: false, error: 'Vyplnte jmeno, e-mail a telefon.' }, { status: 400 })
    }

    if (!isValidCustomerEmail(customerEmail)) {
      return NextResponse.json({ ok: false, error: 'Vyplnte platny e-mail.' }, { status: 400 })
    }

    if (!isValidCustomerPhone(customerPhone)) {
      return NextResponse.json({ ok: false, error: 'Vyplnte platne telefonni cislo.' }, { status: 400 })
    }

    const supabase = createSupabasePublicClient()
    const userAgent = normalizeOptionalText(request.headers.get('user-agent'), MAX_USER_AGENT_LENGTH)
    const referrer = normalizeReferrer(
      normalizeOptionalText(request.headers.get('referer'), MAX_REFERRER_LENGTH),
    )

    const { data, error } = await supabase.rpc('submit_public_offer_response', {
      input_token: token,
      input_action_type: actionType,
      input_customer_name: customerName,
      input_customer_email: customerEmail,
      input_customer_phone: customerPhone,
      input_note: note,
      input_visitor_id: visitorId,
      input_user_agent: userAgent,
      input_referrer: referrer,
    })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const response = Array.isArray(data) ? data[0] : data

    if (!response?.success) {
      return NextResponse.json({ ok: false, error: 'Reakci se nepodarilo ulozit.' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      newStatus: response.new_status ?? null,
      responseId: response.response_id ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
