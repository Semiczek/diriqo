import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { appendHubSignature } from '@/lib/email/messageContent'
import { sendTransactionalEmail } from '@/lib/email/sendTransactionalEmail'
import type { RelatedEntityType } from '@/lib/email/types'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type SendMailPayload = {
  mailboxId?: string | null
  relatedEntityType?: RelatedEntityType
  relatedEntityId?: string
  customerId?: string | null
  contactId?: string | null
  messageType?: string
  toEmail?: string
  toName?: string | null
  cc?: string | null
  bcc?: string | null
  replyTo?: string | null
  subject?: string
  html?: string | null
  text?: string | null
}

type SenderProfileRow = {
  id: string
  full_name: string | null
}

type EntityContext = {
  customerId: string | null
  contactId: string | null
}

const allowedEntityTypes: RelatedEntityType[] = ['job', 'offer', 'inquiry', 'customer', 'invoice']

function isRelatedEntityType(value: unknown): value is RelatedEntityType {
  return allowedEntityTypes.includes(value as RelatedEntityType)
}

function normalizeOptionalId(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

async function resolveEntityContext(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  relatedEntityType: RelatedEntityType,
  relatedEntityId: string,
): Promise<EntityContext | null> {
  if (relatedEntityType === 'job') {
    const response = await supabase
      .from('jobs')
      .select('id, company_id, customer_id, contact_id')
      .eq('id', relatedEntityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (response.error) throw new Error(response.error.message)
    if (!response.data) return null

    return {
      customerId: response.data.customer_id ?? null,
      contactId: response.data.contact_id ?? null,
    }
  }

  if (relatedEntityType === 'offer') {
    const response = await supabase
      .from('quotes')
      .select('id, company_id, customer_id')
      .eq('id', relatedEntityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (response.error) throw new Error(response.error.message)
    if (!response.data) return null

    return {
      customerId: response.data.customer_id ?? null,
      contactId: null,
    }
  }

  if (relatedEntityType === 'inquiry') {
    const response = await supabase
      .from('leads')
      .select('id, company_id, customer_id')
      .eq('id', relatedEntityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (response.error) throw new Error(response.error.message)
    if (!response.data) return null

    return {
      customerId: response.data.customer_id ?? null,
      contactId: null,
    }
  }

  if (relatedEntityType === 'invoice') {
    const response = await supabase
      .from('invoices')
      .select('id, company_id, customer_id')
      .eq('id', relatedEntityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (response.error) throw new Error(response.error.message)
    if (!response.data) return null

    return {
      customerId: response.data.customer_id ?? null,
      contactId: null,
    }
  }

  const response = await supabase
    .from('customers')
    .select('id, company_id')
    .eq('id', relatedEntityId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (response.error) throw new Error(response.error.message)
  if (!response.data) return null

  return {
    customerId: response.data.id,
    contactId: null,
  }
}

async function validateCustomerId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  entityContext: EntityContext,
  requestedCustomerId: string | null,
) {
  const customerId = requestedCustomerId ?? entityContext.customerId

  if (!customerId) {
    return null
  }

  if (entityContext.customerId && customerId !== entityContext.customerId) {
    return {
      ok: false as const,
      error: 'Customer does not belong to the verified target entity.',
    }
  }

  if (!entityContext.customerId && requestedCustomerId) {
    return {
      ok: false as const,
      error: 'Customer cannot be overridden for this target entity.',
    }
  }

  const customerResponse = await supabase
    .from('customers')
    .select('id, company_id')
    .eq('id', customerId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (customerResponse.error) {
    throw new Error(customerResponse.error.message)
  }

  if (!customerResponse.data) {
    return {
      ok: false as const,
      error: 'Customer does not belong to the active company.',
    }
  }

  return {
    ok: true as const,
    customerId,
  }
}

async function validateContactId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  relatedEntityType: RelatedEntityType,
  relatedEntityId: string,
  customerId: string | null,
  entityContext: EntityContext,
  requestedContactId: string | null,
) {
  const contactId = requestedContactId ?? entityContext.contactId

  if (!contactId) {
    return {
      ok: true as const,
      contactId: null,
    }
  }

  if (!customerId) {
    return {
      ok: false as const,
      error: 'Contact cannot be used without a verified customer.',
    }
  }

  const contactResponse = await supabase
    .from('customer_contacts')
    .select('id, customer_id')
    .eq('id', contactId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (contactResponse.error) {
    throw new Error(contactResponse.error.message)
  }

  if (!contactResponse.data) {
    return {
      ok: false as const,
      error: 'Contact does not belong to the verified customer.',
    }
  }

  const customerResponse = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (customerResponse.error) {
    throw new Error(customerResponse.error.message)
  }

  if (!customerResponse.data) {
    return {
      ok: false as const,
      error: 'Contact does not belong to the active company.',
    }
  }

  if (relatedEntityType === 'job' && requestedContactId && requestedContactId !== entityContext.contactId) {
    const jobContactResponse = await supabase
      .from('job_customer_contacts')
      .select('id')
      .eq('job_id', relatedEntityId)
      .eq('customer_contact_id', requestedContactId)
      .maybeSingle()

    if (jobContactResponse.error) {
      throw new Error(jobContactResponse.error.message)
    }

    if (!jobContactResponse.data) {
      return {
        ok: false as const,
        error: 'Contact is not linked to the verified job.',
      }
    }
  }

  return {
    ok: true as const,
    contactId,
  }
}

export async function POST(request: NextRequest) {
  try {
    const activeCompany = await getActiveCompanyContext()

    if (!activeCompany) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as SendMailPayload
    const relatedEntityType = body.relatedEntityType
    const relatedEntityId = body.relatedEntityId?.trim() ?? ''
    const toEmail = body.toEmail?.trim().toLowerCase() ?? ''
    const subject = body.subject?.trim() ?? ''
    const messageType = body.messageType?.trim() ?? 'manual'

    if (!isRelatedEntityType(relatedEntityType) || !relatedEntityId || !toEmail || !subject) {
      return NextResponse.json({ ok: false, error: 'Missing required email data.' }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const entityContext = await resolveEntityContext(
      supabase,
      activeCompany.companyId,
      relatedEntityType,
      relatedEntityId,
    )

    if (!entityContext) {
      return NextResponse.json({ ok: false, error: 'Target entity was not found.' }, { status: 404 })
    }

    const requestedCustomerId = normalizeOptionalId(body.customerId)
    const requestedContactId = normalizeOptionalId(body.contactId)
    const customerValidation = await validateCustomerId(
      supabase,
      activeCompany.companyId,
      entityContext,
      requestedCustomerId,
    )

    if (customerValidation && !customerValidation.ok) {
      return NextResponse.json({ ok: false, error: customerValidation.error }, { status: 400 })
    }

    const resolvedCustomerId = customerValidation?.customerId ?? null
    const contactValidation = await validateContactId(
      supabase,
      activeCompany.companyId,
      relatedEntityType,
      relatedEntityId,
      resolvedCustomerId,
      entityContext,
      requestedContactId,
    )

    if (!contactValidation.ok) {
      return NextResponse.json({ ok: false, error: contactValidation.error }, { status: 400 })
    }

    const senderProfileResponse = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', activeCompany.profileId)
      .maybeSingle()

    if (senderProfileResponse.error) {
      throw new Error(senderProfileResponse.error.message)
    }

    const signedContent = appendHubSignature({
      text: body.text ?? null,
      html: body.html ?? null,
      senderProfileId: activeCompany.profileId,
      senderName: (senderProfileResponse.data as SenderProfileRow | null)?.full_name ?? null,
      sentAt: new Date(),
    })

    const result = await sendTransactionalEmail(
      {
        companyId: activeCompany.companyId,
        mailboxId: body.mailboxId ?? null,
        relatedEntityType,
        relatedEntityId,
        customerId: resolvedCustomerId,
        contactId: contactValidation.contactId,
        messageType,
        toEmail,
        toName: body.toName ?? null,
        cc: body.cc ?? null,
        bcc: body.bcc ?? null,
        replyTo: body.replyTo ?? null,
        subject,
        html: signedContent.html,
        text: signedContent.text,
        triggeredByUserId: activeCompany.profileId,
        triggeredAutomatically: false,
      },
      supabase,
    )

    return NextResponse.json({
      ok: true,
      threadId: result.thread.id,
      outboundMessageId: result.outboundMessage.id,
      status: result.outboundMessage.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[EMAIL] Send route failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
