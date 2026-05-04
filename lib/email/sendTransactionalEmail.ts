import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { buildInternetMessageId } from '@/lib/email/buildInternetMessageId'
import { buildTrackingToken } from '@/lib/email/buildTrackingToken'
import { findOrCreateThread } from '@/lib/email/findOrCreateThread'
import { logMessageEvent } from '@/lib/email/logMessageEvent'
import { appendTrackingTokenToSubject, normalizeSubject } from '@/lib/email/normalizeSubject'
import type { MailboxRow, SendTransactionalEmailInput, SendTransactionalEmailResult } from '@/lib/email/types'

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim()

  if (!apiKey) {
    throw new Error('Chybí RESEND_API_KEY.')
  }

  return new Resend(apiKey)
}

function getDefaultMailboxName() {
  return process.env.MAILBOX_DEFAULT_FROM_NAME?.trim() || 'Diriqo'
}

function getDefaultMailboxEmail() {
  const email = process.env.MAILBOX_DEFAULT_FROM_EMAIL?.trim()

  if (!email) {
    throw new Error('Chybí MAILBOX_DEFAULT_FROM_EMAIL.')
  }

  return email
}

async function getOrProvisionMailbox(
  supabase: SupabaseClient,
  companyId: string,
  mailboxId?: string | null,
): Promise<MailboxRow> {
  if (mailboxId) {
    const explicitMailbox = await supabase
      .from('mailboxes')
      .select('id, company_id, name, email_address, provider_type, is_active, is_default_outbound, is_default_inbound')
      .eq('company_id', companyId)
      .eq('id', mailboxId)
      .maybeSingle()

    if (explicitMailbox.error) {
      throw new Error(`Nepodařilo se načíst mailbox: ${explicitMailbox.error.message}`)
    }

    if (explicitMailbox.data) {
      return explicitMailbox.data as MailboxRow
    }
  }

  const defaultMailboxResponse = await supabase
    .from('mailboxes')
    .select('id, company_id, name, email_address, provider_type, is_active, is_default_outbound, is_default_inbound')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('is_default_outbound', true)
    .maybeSingle()

  if (defaultMailboxResponse.error && defaultMailboxResponse.error.code !== 'PGRST116') {
    throw new Error(`Nepodařilo se načíst výchozí mailbox: ${defaultMailboxResponse.error.message}`)
  }

  if (defaultMailboxResponse.data) {
    return defaultMailboxResponse.data as MailboxRow
  }

  const insertedMailbox = await supabase
    .from('mailboxes')
    .insert({
      company_id: companyId,
      name: getDefaultMailboxName(),
      email_address: getDefaultMailboxEmail(),
      provider_type: 'resend',
      is_active: true,
      is_default_outbound: true,
      is_default_inbound: true,
    })
    .select('id, company_id, name, email_address, provider_type, is_active, is_default_outbound, is_default_inbound')
    .single()

  if (insertedMailbox.error || !insertedMailbox.data) {
    throw new Error(`Nepodařilo se vytvořit výchozí mailbox: ${insertedMailbox.error?.message ?? 'unknown error'}`)
  }

  return insertedMailbox.data as MailboxRow
}

async function getLastThreadReferenceMessageId(supabase: SupabaseClient, threadId: string) {
  const latestInboundResponse = await supabase
    .from('inbound_messages')
    .select('internet_message_id, received_at')
    .eq('thread_id', threadId)
    .not('internet_message_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestInboundResponse.error && latestInboundResponse.data?.internet_message_id) {
    return latestInboundResponse.data.internet_message_id as string
  }

  const latestOutboundResponse = await supabase
    .from('outbound_messages')
    .select('internet_message_id, sent_at, created_at')
    .eq('thread_id', threadId)
    .not('internet_message_id', 'is', null)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestOutboundResponse.error) {
    throw new Error(`Nepodařilo se načíst poslední thread reference: ${latestOutboundResponse.error.message}`)
  }

  return (latestOutboundResponse.data?.internet_message_id as string | null) ?? null
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<SendTransactionalEmailResult> {
  const resend = getResendClient()
  const mailbox = await getOrProvisionMailbox(supabase, input.companyId, input.mailboxId)
  const thread = await findOrCreateThread({
    companyId: input.companyId,
    mailboxId: mailbox.id,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    customerId: input.customerId,
    contactId: input.contactId,
    subject: input.subject,
  }, supabase)

  const trackingToken = buildTrackingToken()
  const internetMessageId = buildInternetMessageId()
  const subjectRendered = appendTrackingTokenToSubject(input.subject, trackingToken)
  const referenceMessageId = await getLastThreadReferenceMessageId(supabase, thread.id)

  const outboundInsertResponse = await supabase
    .from('outbound_messages')
    .insert({
      company_id: input.companyId,
      mailbox_id: mailbox.id,
      thread_id: thread.id,
      related_entity_type: input.relatedEntityType,
      related_entity_id: input.relatedEntityId,
      customer_id: input.customerId ?? null,
      contact_id: input.contactId ?? null,
      message_type: input.messageType,
      to_email: input.toEmail,
      to_name: input.toName ?? null,
      cc: input.cc ?? null,
      bcc: input.bcc ?? null,
      reply_to: input.replyTo ?? mailbox.email_address,
      subject_rendered: subjectRendered,
      html_rendered: input.html ?? null,
      text_rendered: input.text ?? null,
      provider: 'resend',
      internet_message_id: internetMessageId,
      tracking_token: trackingToken,
      status: 'queued',
      triggered_by_user_id: input.triggeredByUserId ?? null,
      triggered_automatically: input.triggeredAutomatically ?? false,
    })
    .select(
      'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, message_type, to_email, to_name, cc, bcc, reply_to, subject_rendered, html_rendered, text_rendered, provider, provider_message_id, internet_message_id, tracking_token, status, error_code, error_message, triggered_by_user_id, triggered_automatically, sent_at, created_at',
    )
    .single()

  if (outboundInsertResponse.error || !outboundInsertResponse.data) {
    throw new Error(`Nepodařilo se uložit outbound message: ${outboundInsertResponse.error?.message ?? 'unknown error'}`)
  }

  const outboundMessage = outboundInsertResponse.data

  await logMessageEvent(
    {
      companyId: input.companyId,
      threadId: thread.id,
      outboundMessageId: outboundMessage.id,
      eventType: 'created',
      note: 'Outbound message created.',
    },
    supabase,
  )

  await logMessageEvent(
    {
      companyId: input.companyId,
      threadId: thread.id,
      outboundMessageId: outboundMessage.id,
      eventType: 'queued',
      note: 'Outbound message queued for Resend delivery.',
    },
    supabase,
  )

  const resendPayload = {
    from: `${mailbox.name} <${mailbox.email_address}>`,
    to: [input.toEmail],
    cc: input.cc ? [input.cc] : undefined,
    bcc: input.bcc ? [input.bcc] : undefined,
    replyTo: input.replyTo ?? mailbox.email_address,
    subject: subjectRendered,
    html: input.html ?? undefined,
    text: input.text ?? undefined,
    headers: {
      'Message-ID': internetMessageId,
      ...(referenceMessageId
        ? {
            'In-Reply-To': referenceMessageId,
            References: referenceMessageId,
          }
        : {}),
    },
    attachments: input.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType ?? undefined,
    })),
  } as Parameters<typeof resend.emails.send>[0]

  const { data: resendData, error: resendError } = await resend.emails.send(
    resendPayload
  )

  if (resendError) {
    await supabase
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: resendError.message,
      })
      .eq('id', outboundMessage.id)

    await logMessageEvent(
      {
        companyId: input.companyId,
        threadId: thread.id,
        outboundMessageId: outboundMessage.id,
        eventType: 'failed',
        note: resendError.message,
        providerPayload: resendError,
      },
      supabase,
    )

    throw new Error(`Nepodařilo se odeslat email: ${resendError.message}`)
  }

  const sentAt = new Date().toISOString()

  const updatedOutboundResponse = await supabase
    .from('outbound_messages')
    .update({
      provider_message_id: resendData?.id ?? null,
      status: 'sent',
      sent_at: sentAt,
      error_code: null,
      error_message: null,
    })
    .eq('id', outboundMessage.id)
    .select(
      'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, message_type, to_email, to_name, cc, bcc, reply_to, subject_rendered, html_rendered, text_rendered, provider, provider_message_id, internet_message_id, tracking_token, status, error_code, error_message, triggered_by_user_id, triggered_automatically, sent_at, created_at',
    )
    .single()

  if (updatedOutboundResponse.error || !updatedOutboundResponse.data) {
    throw new Error(`Nepodařilo se aktualizovat outbound message: ${updatedOutboundResponse.error?.message ?? 'unknown error'}`)
  }

  await supabase
    .from('message_threads')
    .update({
      status: 'waiting_customer',
      last_message_at: sentAt,
      last_outbound_at: sentAt,
      has_unread_inbound: false,
      subject_original: input.subject,
      subject_normalized: normalizeSubject(input.subject) || null,
    })
    .eq('id', thread.id)

  await logMessageEvent(
    {
      companyId: input.companyId,
      threadId: thread.id,
      outboundMessageId: outboundMessage.id,
      eventType: 'provider_accepted',
      providerEventId: resendData?.id ?? null,
      note: 'Resend accepted outbound message.',
    },
    supabase,
  )

  await logMessageEvent(
    {
      companyId: input.companyId,
      threadId: thread.id,
      outboundMessageId: outboundMessage.id,
      eventType: 'sent',
      providerEventId: resendData?.id ?? null,
      note: 'Outbound message marked as sent.',
    },
    supabase,
  )

  return {
    thread,
    outboundMessage: updatedOutboundResponse.data,
  }
}
