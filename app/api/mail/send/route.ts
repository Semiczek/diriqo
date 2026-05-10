import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  buildCompanySender,
  buildThreadReplyToAddress,
  createThreadKey,
  getMailgunFromDomain,
} from '@/lib/mail/addressing'
import { sendMailgunMessage } from '@/lib/mail/mailgun'
import { requireAuthenticatedUser, requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

type SendMailPayload = {
  customer_id?: unknown
  customerId?: unknown
  job_id?: unknown
  jobId?: unknown
  offer_id?: unknown
  offerId?: unknown
  thread_id?: unknown
  threadId?: unknown
  to_email?: unknown
  toEmail?: unknown
  to_name?: unknown
  toName?: unknown
  subject?: unknown
  body_text?: unknown
  bodyText?: unknown
  text?: unknown
  body_html?: unknown
  bodyHtml?: unknown
  html?: unknown
  relatedEntityType?: unknown
  relatedEntityId?: unknown
}

type MailThreadRow = {
  id: string
  company_id: string
  customer_id: string | null
  job_id: string | null
  offer_id: string | null
  subject: string
  thread_key: string
}

type EntityContext = {
  customerId: string | null
  jobId: string | null
  offerId: string | null
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalString(value: unknown) {
  const normalized = getString(value)
  return normalized || null
}

function normalizeEmail(value: unknown) {
  return getString(value).toLowerCase()
}

function formatEmailAddress(name: string | null | undefined, email: string) {
  const safeName = name?.trim().replace(/[<>"]/g, '') ?? ''
  return safeName ? `${safeName} <${email}>` : email
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textToHtml(value: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
    value
  ).replace(/\n/g, '<br />')}</div>`
}

function normalizePayload(body: SendMailPayload) {
  const legacyEntityType = getString(body.relatedEntityType)
  const legacyEntityId = getString(body.relatedEntityId)

  return {
    customerId:
      getOptionalString(body.customer_id) ??
      getOptionalString(body.customerId) ??
      (legacyEntityType === 'customer' ? legacyEntityId : null),
    jobId:
      getOptionalString(body.job_id) ??
      getOptionalString(body.jobId) ??
      (legacyEntityType === 'job' ? legacyEntityId : null),
    offerId:
      getOptionalString(body.offer_id) ??
      getOptionalString(body.offerId) ??
      (legacyEntityType === 'offer' ? legacyEntityId : null),
    threadId: getOptionalString(body.thread_id) ?? getOptionalString(body.threadId),
    toEmail: normalizeEmail(body.to_email) || normalizeEmail(body.toEmail),
    toName: getOptionalString(body.to_name) ?? getOptionalString(body.toName),
    subject: getString(body.subject),
    bodyText: getString(body.body_text) || getString(body.bodyText) || getString(body.text),
    bodyHtml: getOptionalString(body.body_html) ?? getOptionalString(body.bodyHtml) ?? getOptionalString(body.html),
  }
}

async function logMailEvent(
  admin: SupabaseClient,
  input: {
    companyId: string
    messageId?: string | null
    eventType: string
    providerPayload?: unknown
  }
) {
  const { error } = await admin.from('mail_events').insert({
    company_id: input.companyId,
    message_id: input.messageId ?? null,
    event_type: input.eventType,
    provider: 'mailgun',
    provider_payload: input.providerPayload ?? null,
  })

  if (error) {
    console.error('[MAILGUN] Failed to log mail event', {
      error: error.message,
      eventType: input.eventType,
      companyId: input.companyId,
    })
  }
}

async function resolveEntityContext(
  admin: SupabaseClient,
  companyId: string,
  input: EntityContext
): Promise<EntityContext | null> {
  if (input.jobId) {
    const { data, error } = await admin
      .from('jobs')
      .select('id, company_id, customer_id')
      .eq('id', input.jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return null
    if (input.customerId && input.customerId !== data.customer_id) return null

    return {
      jobId: data.id,
      customerId: data.customer_id ?? null,
      offerId: null,
    }
  }

  if (input.offerId) {
    const { data, error } = await admin
      .from('quotes')
      .select('id, company_id, customer_id')
      .eq('id', input.offerId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return null
    if (input.customerId && input.customerId !== data.customer_id) return null

    return {
      jobId: null,
      customerId: data.customer_id ?? null,
      offerId: data.id,
    }
  }

  if (input.customerId) {
    const { data, error } = await admin
      .from('customers')
      .select('id, company_id')
      .eq('id', input.customerId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return null

    return {
      jobId: null,
      customerId: data.id,
      offerId: null,
    }
  }

  return {
    jobId: null,
    customerId: null,
    offerId: null,
  }
}

async function loadThread(admin: SupabaseClient, companyId: string, threadId: string) {
  const { data, error } = await admin
    .from('mail_threads')
    .select('id, company_id, customer_id, job_id, offer_id, subject, thread_key')
    .eq('id', threadId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as MailThreadRow | null) ?? null
}

async function createThread(
  admin: SupabaseClient,
  input: {
    companyId: string
    customerId: string | null
    jobId: string | null
    offerId: string | null
    subject: string
    createdBy: string
  }
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin
      .from('mail_threads')
      .insert({
        company_id: input.companyId,
        customer_id: input.customerId,
        job_id: input.jobId,
        offer_id: input.offerId,
        subject: input.subject,
        thread_key: createThreadKey(),
        status: 'open',
        created_by: input.createdBy,
        last_message_at: new Date().toISOString(),
      })
      .select('id, company_id, customer_id, job_id, offer_id, subject, thread_key')
      .single()

    if (!error && data) return data as MailThreadRow
    if (error?.code !== '23505') throw new Error(error?.message ?? 'Thread could not be created.')
  }

  throw new Error('Thread key could not be generated.')
}

async function getLatestMessageReference(admin: SupabaseClient, threadId: string) {
  const { data, error } = await admin
    .from('mail_messages')
    .select('provider_message_id, mailgun_message_id')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(error.message)

  const latestWithReference = (data ?? []).find((message) =>
    Boolean(message.provider_message_id ?? message.mailgun_message_id)
  )

  return (latestWithReference?.provider_message_id ?? latestWithReference?.mailgun_message_id ?? null) as string | null
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthenticatedUser()
    if (!authResult.ok) {
      return NextResponse.json({ ok: false, error: authResult.error }, { status: authResult.status })
    }

    const activeCompanyResult = await requireCompanyRole('manager', 'company_admin', 'super_admin')
    if (!activeCompanyResult.ok) {
      return NextResponse.json({ ok: false, error: activeCompanyResult.error }, { status: activeCompanyResult.status })
    }

    const body = (await request.json().catch(() => ({}))) as SendMailPayload
    const input = normalizePayload(body)

    if (!input.toEmail || !input.subject || (!input.bodyText && !input.bodyHtml)) {
      return NextResponse.json({ ok: false, error: 'Missing required email data.' }, { status: 400 })
    }

    const activeCompany = activeCompanyResult.value
    const admin = createSupabaseAdminClient()
    const thread = input.threadId
      ? await loadThread(admin, activeCompany.companyId, input.threadId)
      : null

    if (input.threadId && !thread) {
      return NextResponse.json({ ok: false, error: 'Thread was not found.' }, { status: 404 })
    }

    const entityContext = thread
      ? {
          customerId: thread.customer_id,
          jobId: thread.job_id,
          offerId: thread.offer_id,
        }
      : await resolveEntityContext(admin, activeCompany.companyId, {
          customerId: input.customerId,
          jobId: input.jobId,
          offerId: input.offerId,
        })

    if (!entityContext) {
      return NextResponse.json({ ok: false, error: 'Target entity was not found.' }, { status: 404 })
    }

    const mailThread = thread ?? await createThread(admin, {
      companyId: activeCompany.companyId,
      customerId: entityContext.customerId,
      jobId: entityContext.jobId,
      offerId: entityContext.offerId,
      subject: input.subject,
      createdBy: activeCompany.profileId,
    })
    const subject = input.subject || mailThread.subject
    const sender = buildCompanySender({ companyName: activeCompany.companyName })
    const replyTo = buildThreadReplyToAddress(mailThread.thread_key)
    const references = await getLatestMessageReference(admin, mailThread.id)
    const bodyHtml = input.bodyHtml ?? (input.bodyText ? textToHtml(input.bodyText) : null)

    const { data: message, error: messageError } = await admin
      .from('mail_messages')
      .insert({
        company_id: activeCompany.companyId,
        thread_id: mailThread.id,
        direction: 'outbound',
        from_email: sender.email,
        from_name: sender.name,
        to_email: input.toEmail,
        to_name: input.toName,
        subject,
        body_text: input.bodyText || null,
        body_html: bodyHtml,
        provider: 'mailgun',
        in_reply_to: references,
        references_header: references,
        recipient_email: replyTo,
        sent_by: activeCompany.profileId,
      })
      .select('id')
      .single()

    if (messageError || !message?.id) {
      throw new Error(messageError?.message ?? 'Outbound message could not be saved.')
    }

    await logMailEvent(admin, {
      companyId: activeCompany.companyId,
      messageId: message.id,
      eventType: 'outbound_created',
    })

    const messageId = `<${message.id}.${mailThread.thread_key}@${getMailgunFromDomain()}>`

    try {
      const mailgunResult = await sendMailgunMessage({
        from: sender.formatted,
        to: formatEmailAddress(input.toName, input.toEmail),
        replyTo,
        subject,
        text: input.bodyText || null,
        html: bodyHtml,
        messageId,
        inReplyTo: references,
        references,
      })

      const providerMessageId = mailgunResult.id ?? messageId
      const sentAt = new Date().toISOString()

      const { error: updateMessageError } = await admin
        .from('mail_messages')
        .update({
          provider_message_id: providerMessageId,
          mailgun_message_id: providerMessageId,
          sent_at: sentAt,
        })
        .eq('id', message.id)

      if (updateMessageError) throw new Error(updateMessageError.message)

      const { error: updateThreadError } = await admin
        .from('mail_threads')
        .update({
          last_message_at: sentAt,
          updated_at: sentAt,
        })
        .eq('id', mailThread.id)

      if (updateThreadError) throw new Error(updateThreadError.message)

      await logMailEvent(admin, {
        companyId: activeCompany.companyId,
        messageId: message.id,
        eventType: 'sent',
        providerPayload: mailgunResult,
      })

      return NextResponse.json({
        ok: true,
        threadId: mailThread.id,
        messageId: message.id,
        mailgunMessageId: providerMessageId,
      })
    } catch (error) {
      await logMailEvent(admin, {
        companyId: activeCompany.companyId,
        messageId: message.id,
        eventType: 'send_failed',
        providerPayload: {
          error: error instanceof Error ? error.message : 'Unexpected Mailgun error',
        },
      })
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[MAILGUN] Send route failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
