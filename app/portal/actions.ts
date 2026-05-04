'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { canPortalApproveOffer } from '@/lib/customer-portal/data'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function normalizeText(value: FormDataEntryValue | null, maxLength: number) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

function normalizeOfferResponseAction(value: string) {
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

export async function createPortalInquiryAction(formData: FormData) {
  const portalUser = await requirePortalUserContext()
  const admin = createSupabaseAdminClient()

  const subject = normalizeText(formData.get('subject'), 160)
  const locationText = normalizeText(formData.get('locationText'), 160)
  const description = normalizeText(formData.get('description'), 4000)
  const preferredMonth = normalizeText(formData.get('preferredMonth'), 7)
  const note = normalizeText(formData.get('note'), 2000)

  if (!subject || !description) {
    redirect('/portal/inquiries/new?error=missing-required')
  }

  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id, name, company_id')
    .eq('id', portalUser.customerId)
    .maybeSingle()

  if (customerError || !customer?.company_id) {
    redirect('/portal/inquiries/new?error=missing-customer')
  }

  const { data: insertedLead, error: insertError } = await admin
    .from('leads')
    .insert({
      company_id: customer.company_id,
      customer_id: portalUser.customerId,
      customer_portal_user_id: portalUser.portalUserId,
      name: portalUser.fullName?.trim() || portalUser.email,
      company_name: customer.name?.trim() || null,
      email: portalUser.email,
      phone: null,
      message: description,
      subject,
      location_text: locationText || null,
      preferred_month: /^\d{4}-\d{2}$/.test(preferredMonth) ? `${preferredMonth}-01` : null,
      customer_note: note || null,
      website_locale: 'cs',
      source: 'customer_portal',
      status: 'new',
    })
    .select('id')
    .single()

  if (insertError || !insertedLead?.id) {
    redirect('/portal/inquiries/new?error=save-failed')
  }

  revalidatePath('/portal')
  revalidatePath('/portal/inquiries')
  redirect(`/portal/inquiries/${insertedLead.id}`)
}

export async function approvePortalOfferAction(formData: FormData) {
  const portalUser = await requirePortalUserContext()
  const admin = createSupabaseAdminClient()

  const offerId = normalizeText(formData.get('offerId'), 64)
  const note = normalizeText(formData.get('approvalNote'), 2000)

  if (!offerId) {
    redirect('/portal/offers?error=missing-offer')
  }

  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .select('id, customer_id, status, valid_until, accepted_at')
    .eq('id', offerId)
    .eq('customer_id', portalUser.customerId)
    .maybeSingle()

  if (quoteError || !quote) {
    redirect('/portal/offers?error=not-found')
  }

  if (!canPortalApproveOffer(quote)) {
    redirect(`/portal/offers/${offerId}?error=already-closed`)
  }

  const now = new Date().toISOString()

  const { error: updateError } = await admin
    .from('quotes')
    .update({
      status: 'accepted',
      accepted_at: now,
      customer_portal_approved_by: portalUser.portalUserId,
      customer_portal_approved_note: note || null,
    })
    .eq('id', offerId)
    .eq('customer_id', portalUser.customerId)

  if (updateError) {
    redirect(`/portal/offers/${offerId}?error=save-failed`)
  }

  await admin.from('offer_events').insert({
    quote_id: offerId,
    section_key: 'portal',
    event_type: 'portal_offer_approved',
    event_value: note || null,
    visitor_id: portalUser.portalUserId,
  })

  revalidatePath('/portal')
  revalidatePath('/portal/offers')
  revalidatePath(`/portal/offers/${offerId}`)
  redirect(`/portal/offers/${offerId}?approved=1`)
}

export async function submitPortalOfferResponseAction(formData: FormData) {
  const portalUser = await requirePortalUserContext()
  const admin = createSupabaseAdminClient()

  const offerId = normalizeText(formData.get('offerId'), 64)
  const actionType = normalizeOfferResponseAction(normalizeText(formData.get('actionType'), 40))
  const note = normalizeText(formData.get('responseNote'), 2000)

  if (!offerId || !actionType) {
    redirect('/portal/offers?error=missing-offer')
  }

  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .select('id, title, customer_id, status, valid_until, accepted_at')
    .eq('id', offerId)
    .eq('customer_id', portalUser.customerId)
    .maybeSingle()

  if (quoteError || !quote) {
    redirect('/portal/offers?error=not-found')
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
    redirect(`/portal/offers/${offerId}?error=already-closed`)
  }

  const nextStatus =
    actionType === 'revision_requested'
      ? 'revision_requested'
      : actionType === 'not_interested'
      ? 'rejected'
      : actionType === 'interested' || actionType === 'contact_requested'
      ? 'waiting_followup'
      : normalizedStatus || null

  const eventType =
    actionType === 'interested'
      ? 'portal_offer_interested'
      : actionType === 'contact_requested'
      ? 'portal_offer_contact_requested'
      : actionType === 'revision_requested'
      ? 'portal_offer_revision_requested'
      : 'portal_offer_not_interested'

  const insertResponse = await admin.from('offer_responses').insert({
    quote_id: offerId,
    quote_title_snapshot: quote.title || 'Nabídka',
    action_type: actionType,
    customer_name: portalUser.fullName?.trim() || portalUser.customerName?.trim() || portalUser.email,
    customer_email: portalUser.email,
    customer_phone: '-',
    note: note || null,
    visitor_id: portalUser.portalUserId,
    user_agent: 'customer_portal',
    referrer: '/portal/offers',
  })

  if (insertResponse.error) {
    redirect(`/portal/offers/${offerId}?error=save-failed`)
  }

  if (nextStatus) {
    const updateResponse = await admin
      .from('quotes')
      .update({ status: nextStatus })
      .eq('id', offerId)
      .eq('customer_id', portalUser.customerId)

    if (updateResponse.error) {
      redirect(`/portal/offers/${offerId}?error=save-failed`)
    }
  }

  await admin.from('offer_events').insert({
    quote_id: offerId,
    section_key: 'portal',
    event_type: eventType,
    event_value: note || null,
    visitor_id: portalUser.portalUserId,
  })

  revalidatePath('/portal')
  revalidatePath('/portal/offers')
  revalidatePath(`/portal/offers/${offerId}`)
  redirect(`/portal/offers/${offerId}?response=1`)
}
