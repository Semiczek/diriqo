import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { logMessageEvent } from '@/lib/email/logMessageEvent'
import { matchInboundMessage } from '@/lib/email/matchInboundMessage'
import { parseMailboxAddress } from '@/lib/email/parseAddress'
import { upsertInboundMessage } from '@/lib/email/upsertInboundMessage'
import type { NormalizedInboundPayload } from '@/lib/email/types'

export const runtime = 'nodejs'

type ResendWebhookPayload = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    created_at?: string
    from?: string
    to?: string[]
    cc?: string[]
    bcc?: string[]
    subject?: string
    message_id?: string
  }
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) throw new Error('Chybí RESEND_API_KEY.')
  return new Resend(apiKey)
}

function getWebhookSecret() {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('Chybí RESEND_WEBHOOK_SECRET.')
  return secret
}

async function verifyWebhook(request: NextRequest, payload: string) {
  const resend = getResendClient()

  return resend.webhooks.verify({
    payload,
    headers: {
      id: request.headers.get('svix-id') ?? '',
      timestamp: request.headers.get('svix-timestamp') ?? '',
      signature: request.headers.get('svix-signature') ?? '',
    },
    webhookSecret: getWebhookSecret(),
  })
}

async function updateOutboundStatusByProviderMessageId(
  providerMessageId: string,
  nextStatus: 'sent' | 'delivered' | 'bounced' | 'failed',
  eventType: string,
  payload: unknown,
) {
  const supabase = createSupabaseAdminClient()
  const outboundResponse = await supabase
    .from('outbound_messages')
    .select('id, company_id, thread_id')
    .eq('provider', 'resend')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()

  if (outboundResponse.error) {
    throw new Error(`Nepodařilo se dohledat outbound message pro webhook: ${outboundResponse.error.message}`)
  }

  if (!outboundResponse.data) {
    return
  }

  const nowIso = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('outbound_messages')
    .update({
      status: nextStatus,
      sent_at: nextStatus === 'sent' ? nowIso : undefined,
      error_message: nextStatus === 'failed' ? `Webhook event ${eventType}` : null,
    })
    .eq('id', outboundResponse.data.id)

  if (updateError) {
    throw new Error(`Nepodařilo se aktualizovat outbound status: ${updateError.message}`)
  }

  await logMessageEvent({
    companyId: outboundResponse.data.company_id,
    threadId: outboundResponse.data.thread_id,
    outboundMessageId: outboundResponse.data.id,
    eventType,
    providerEventId: providerMessageId,
    providerPayload: payload,
  })
}

async function resolveMailboxByInboundAddress(emailAddress: string) {
  const supabase = createSupabaseAdminClient()
  const response = await supabase
    .from('mailboxes')
    .select('id, company_id, email_address')
    .ilike('email_address', emailAddress)
    .maybeSingle()

  if (response.error) {
    throw new Error(`Nepodařilo se najít inbound mailbox: ${response.error.message}`)
  }

  return response.data
}

async function processInboundEmail(event: ResendWebhookPayload) {
  const resend = getResendClient()
  const supabase = createSupabaseAdminClient()
  const emailId = event.data?.email_id?.trim() ?? ''

  if (!emailId) {
    throw new Error('Chybí event.data.email_id pro inbound email.')
  }

  const { data: receivedEmail, error: receivedEmailError } = await resend.emails.receiving.get(emailId)

  if (receivedEmailError || !receivedEmail) {
    throw new Error(`Nepodařilo se načíst inbound email z Resend: ${receivedEmailError?.message ?? 'unknown error'}`)
  }

  const toEmail = receivedEmail.to?.[0] ?? event.data?.to?.[0] ?? ''
  const mailbox = await resolveMailboxByInboundAddress(String(toEmail).toLowerCase())

  if (!mailbox?.id || !mailbox.company_id) {
    throw new Error(`Nepodařilo se spárovat inbound mailbox pro adresu ${toEmail}.`)
  }

  const parsedFrom = parseMailboxAddress(receivedEmail.from)
  const headers = (receivedEmail.headers ?? {}) as Record<string, string>

  const normalizedPayload: NormalizedInboundPayload = {
    companyId: mailbox.company_id,
    mailboxEmail: mailbox.email_address,
    provider: 'resend',
    providerMessageId: emailId,
    internetMessageId: receivedEmail.message_id ?? event.data?.message_id ?? null,
    inReplyToMessageId: headers['in-reply-to'] ?? headers['In-Reply-To'] ?? null,
    referencesHeader: headers.references ?? headers.References ?? null,
    fromEmail: parsedFrom.email,
    fromName: parsedFrom.name,
    toEmail: String(toEmail).toLowerCase(),
    cc: Array.isArray(receivedEmail.cc) ? receivedEmail.cc.join(', ') : null,
    subject: receivedEmail.subject ?? event.data?.subject ?? null,
    htmlBody: receivedEmail.html ?? null,
    textBody: receivedEmail.text ?? null,
    receivedAt: receivedEmail.created_at ?? event.data?.created_at ?? event.created_at ?? new Date().toISOString(),
  }

  const match = await matchInboundMessage(normalizedPayload)
  const inbound = await upsertInboundMessage({
    payload: normalizedPayload,
    match,
    mailboxId: mailbox.id,
  })

  if (match.threadId) {
    const { error: threadUpdateError } = await supabase
      .from('message_threads')
      .update({
        has_unread_inbound: true,
        last_message_at: normalizedPayload.receivedAt,
        last_inbound_at: normalizedPayload.receivedAt,
        status: 'waiting_internal',
      })
      .eq('id', match.threadId)

    if (threadUpdateError) {
      throw new Error(`Nepodařilo se aktualizovat thread po inbound webooku: ${threadUpdateError.message}`)
    }
  }

  await logMessageEvent({
    companyId: mailbox.company_id,
    threadId: match.threadId,
    inboundMessageId: inbound.id,
    eventType: 'inbound_received',
    providerEventId: emailId,
    providerPayload: event,
  })

  await logMessageEvent({
    companyId: mailbox.company_id,
    threadId: match.threadId,
    inboundMessageId: inbound.id,
    eventType:
      match.matchingStatus === 'matched'
        ? 'matched_to_thread'
        : match.matchingStatus === 'fallback_matched'
        ? 'fallback_matched_to_thread'
        : 'unmatched_inbound',
    note: `Inbound matched by ${match.matchedBy}`,
    providerEventId: emailId,
  })
}

export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text()
    const verifiedPayload = (await verifyWebhook(request, rawPayload)) as ResendWebhookPayload
    const eventType = verifiedPayload.type ?? ''
    const providerMessageId = verifiedPayload.data?.email_id?.trim() ?? null

    if (eventType === 'email.sent' && providerMessageId) {
      await updateOutboundStatusByProviderMessageId(providerMessageId, 'sent', 'sent', verifiedPayload)
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'email.delivered' && providerMessageId) {
      await updateOutboundStatusByProviderMessageId(providerMessageId, 'delivered', 'delivered', verifiedPayload)
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'email.bounced' && providerMessageId) {
      await updateOutboundStatusByProviderMessageId(providerMessageId, 'bounced', 'bounced', verifiedPayload)
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'email.failed' && providerMessageId) {
      await updateOutboundStatusByProviderMessageId(providerMessageId, 'failed', 'failed', verifiedPayload)
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'email.received') {
      await processInboundEmail(verifiedPayload)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true, skipped: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[EMAIL] Resend webhook processing failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
