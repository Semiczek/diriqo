import { NextResponse } from 'next/server'

import { getPortalUserContext } from '@/lib/customer-portal/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type PortalOfferAction =
  | 'interested'
  | 'contact_requested'
  | 'revision_requested'
  | 'not_interested'

function normalizeAction(value: unknown): PortalOfferAction | null {
  if (
    value === 'interested' ||
    value === 'contact_requested' ||
    value === 'revision_requested' ||
    value === 'not_interested'
  ) {
    return value
  }

  return null
}

function normalizeText(value: unknown, maxLength: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : ''
}

export async function POST(request: Request) {
  const portalUser = await getPortalUserContext()

  if (!portalUser) {
    return NextResponse.json({ ok: false, error: 'Nejste přihlášený zákazník.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    offerId?: unknown
    actionType?: unknown
    note?: unknown
  } | null

  const offerId = normalizeText(body?.offerId, 64)
  const actionType = normalizeAction(body?.actionType)
  const note = normalizeText(body?.note, 2000)

  if (!offerId || !actionType) {
    return NextResponse.json({ ok: false, error: 'Chybí nabídka nebo typ odpovědi.' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .select('id, title, company_id, customer_id, status, valid_until, accepted_at')
    .eq('id', offerId)
    .eq('customer_id', portalUser.customerId)
    .eq('company_id', portalUser.companyId)
    .maybeSingle()

  if (quoteError || !quote) {
    return NextResponse.json({ ok: false, error: 'Nabídka nebyla nalezena.' }, { status: 404 })
  }

  const normalizedStatus = String(quote.status ?? '').trim().toLowerCase()
  const isExpired =
    quote.valid_until != null &&
    new Date(`${quote.valid_until}T23:59:59`).getTime() < Date.now() &&
    normalizedStatus !== 'accepted'

  if (
    quote.accepted_at ||
    isExpired ||
    normalizedStatus === 'accepted' ||
    normalizedStatus === 'rejected' ||
    normalizedStatus === 'expired'
  ) {
    return NextResponse.json({ ok: false, error: 'Tuto nabídku už není možné upravit.' }, { status: 409 })
  }

  const nextStatus =
    actionType === 'revision_requested'
      ? 'revision_requested'
      : actionType === 'not_interested'
        ? 'rejected'
        : 'waiting_followup'

  const eventType =
    actionType === 'interested'
      ? 'portal_offer_interested'
      : actionType === 'contact_requested'
        ? 'portal_offer_contact_requested'
        : actionType === 'revision_requested'
          ? 'portal_offer_revision_requested'
          : 'portal_offer_not_interested'

  const responseInsert = await admin.from('offer_responses').insert({
    company_id: quote.company_id,
    quote_id: offerId,
    action_type: actionType,
    customer_name: portalUser.fullName?.trim() || portalUser.customerName?.trim() || portalUser.email,
    customer_email: portalUser.email,
    customer_phone: '-',
    note: note || null,
    visitor_id: portalUser.portalUserId,
  })

  if (responseInsert.error) {
    return NextResponse.json({ ok: false, error: responseInsert.error.message }, { status: 400 })
  }

  const quoteUpdate = await admin
    .from('quotes')
    .update({ status: nextStatus })
    .eq('id', offerId)
    .eq('customer_id', portalUser.customerId)
    .eq('company_id', quote.company_id)

  if (quoteUpdate.error) {
    return NextResponse.json({ ok: false, error: quoteUpdate.error.message }, { status: 400 })
  }

  await admin.from('offer_events').insert({
    company_id: quote.company_id,
    quote_id: offerId,
    event_type: eventType,
    visitor_id: portalUser.portalUserId,
  })

  return NextResponse.json({ ok: true })
}
