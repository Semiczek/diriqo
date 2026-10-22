'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { respondToPortalQuote } from '@/lib/dal/core-quote-portal-response'
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
    .eq('company_id', portalUser.companyId)
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
  const user = await requirePortalUserContext()
  const quoteId = normalizeText(formData.get('offerId'), 64)
  const versionId = normalizeText(formData.get('versionId'), 64)
  const operationId = normalizeText(formData.get('operationId'), 64)
  const expectedPortalUserId = normalizeText(formData.get('actorId'), 64)
  const evidence = normalizeText(formData.get('evidence'), 4000)
  try { await respondToPortalQuote(user, { expectedPortalUserId, quoteId, versionId, operationId, decision: 'accepted', evidence }) }
  catch { redirect('/portal/offers?error=confirmation-unavailable') }
  revalidatePath('/portal/offers')
  redirect('/portal/offers/' + quoteId + '?versionId=' + versionId + '&approved=1')
}

export async function submitPortalOfferResponseAction(formData: FormData) {
  const user = await requirePortalUserContext()
  const quoteId = normalizeText(formData.get('offerId'), 64)
  const versionId = normalizeText(formData.get('versionId'), 64)
  const operationId = normalizeText(formData.get('operationId'), 64)
  const expectedPortalUserId = normalizeText(formData.get('actorId'), 64)
  const actionType = normalizeOfferResponseAction(normalizeText(formData.get('actionType'), 40))
  if (!actionType) redirect('/portal/offers?error=invalid-response')
  try { await respondToPortalQuote(user, { expectedPortalUserId, quoteId, versionId, operationId, actionType, note: normalizeText(formData.get('responseNote'), 2000) }) }
  catch { redirect('/portal/offers?error=confirmation-unavailable') }
  revalidatePath('/portal/offers')
  redirect('/portal/offers/' + quoteId + '?versionId=' + versionId + '&response=1')
}
