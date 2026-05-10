import { NextRequest, NextResponse } from 'next/server'

import { parseMailboxAddress } from '@/lib/email/parseAddress'
import { extractThreadKeyFromAddress } from '@/lib/mail/addressing'
import { verifyMailgunSignature } from '@/lib/mail/mailgun-signature'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

type InboundPayload = {
  get: (key: string) => string | null
  raw: Record<string, unknown>
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

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function readInboundPayload(request: NextRequest): Promise<InboundPayload> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    return {
      raw: body,
      get: (key: string) => getString(body[key]),
    }
  }

  const formData = await request.formData()
  const raw: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    raw[key] = typeof value === 'string' ? value : value.name
  }

  return {
    raw,
    get: (key: string) => {
      const value = formData.get(key)
      return typeof value === 'string' ? value.trim() : null
    },
  }
}

function firstValue(payload: InboundPayload, keys: string[]) {
  for (const key of keys) {
    const value = payload.get(key)
    if (value) return value
  }

  return null
}

function getHeaderFromMessageHeaders(payload: InboundPayload, headerName: string) {
  const rawHeaders = payload.get('message-headers')
  if (!rawHeaders) return null

  try {
    const parsed = JSON.parse(rawHeaders) as unknown
    if (!Array.isArray(parsed)) return null

    const match = parsed.find((item) => (
      Array.isArray(item) &&
      String(item[0] ?? '').toLowerCase() === headerName.toLowerCase()
    ))

    return Array.isArray(match) ? getString(match[1]) || null : null
  } catch {
    return null
  }
}

function getProviderMessageId(payload: InboundPayload) {
  return (
    firstValue(payload, ['Message-Id', 'Message-ID', 'message-id', 'message_id']) ??
    getHeaderFromMessageHeaders(payload, 'Message-Id')
  )
}

async function findExistingInboundMessage(companyId: string, providerMessageId: string | null) {
  if (!providerMessageId) return null

  const admin = createSupabaseAdminClient()
  const providerResponse = await admin
    .from('mail_messages')
    .select('id, thread_id')
    .eq('company_id', companyId)
    .eq('direction', 'inbound')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()

  if (providerResponse.error) throw new Error(providerResponse.error.message)
  if (providerResponse.data) return providerResponse.data as { id: string; thread_id: string }

  const mailgunResponse = await admin
    .from('mail_messages')
    .select('id, thread_id')
    .eq('company_id', companyId)
    .eq('direction', 'inbound')
    .eq('mailgun_message_id', providerMessageId)
    .maybeSingle()

  if (mailgunResponse.error) throw new Error(mailgunResponse.error.message)

  return mailgunResponse.data as { id: string; thread_id: string } | null
}

async function logMailEvent(input: {
  companyId: string
  messageId?: string | null
  eventType: string
  providerPayload?: unknown
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('mail_events').insert({
    company_id: input.companyId,
    message_id: input.messageId ?? null,
    event_type: input.eventType,
    provider: 'mailgun',
    provider_payload: input.providerPayload ?? null,
  })

  if (error) {
    console.error('[MAILGUN] Failed to log inbound event', {
      error: error.message,
      companyId: input.companyId,
      eventType: input.eventType,
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await readInboundPayload(request)
    const signatureOk = verifyMailgunSignature({
      timestamp: firstValue(payload, ['timestamp', 'signature[timestamp]']),
      token: firstValue(payload, ['token', 'signature[token]']),
      signature: firstValue(payload, ['signature', 'signature[signature]']),
    })

    if (!signatureOk) {
      return NextResponse.json({ ok: false, error: 'Invalid Mailgun signature.' }, { status: 401 })
    }

    const recipient =
      firstValue(payload, ['recipient', 'Recipient', 'to', 'To', 'Delivered-To', 'X-Original-To']) ?? ''
    const threadKey = extractThreadKeyFromAddress(recipient)

    if (!threadKey) {
      console.warn('[MAILGUN] Inbound email without thread recipient', { recipient })
      return NextResponse.json({ ok: true, matched: false })
    }

    const admin = createSupabaseAdminClient()
    const threadResponse = await admin
      .from('mail_threads')
      .select('id, company_id, customer_id, job_id, offer_id, subject, thread_key')
      .eq('thread_key', threadKey)
      .maybeSingle()

    if (threadResponse.error) throw new Error(threadResponse.error.message)

    const thread = threadResponse.data as MailThreadRow | null
    if (!thread) {
      console.warn('[MAILGUN] Inbound email for unknown thread', { recipient, threadKey })
      return NextResponse.json({ ok: true, matched: false })
    }

    const providerMessageId = getProviderMessageId(payload)
    const existing = await findExistingInboundMessage(thread.company_id, providerMessageId)
    if (existing) {
      return NextResponse.json({
        ok: true,
        matched: true,
        duplicate: true,
        threadId: existing.thread_id,
        messageId: existing.id,
      })
    }

    const parsedFrom = parseMailboxAddress(
      firstValue(payload, ['from', 'From', 'sender', 'Sender']) ?? ''
    )
    const toAddress = parseMailboxAddress(firstValue(payload, ['To', 'to']) ?? recipient)
    const subject = firstValue(payload, ['subject', 'Subject']) ?? thread.subject
    const bodyText =
      firstValue(payload, ['stripped-text', 'body-plain', 'body_plain', 'text']) ?? null
    const bodyHtml =
      firstValue(payload, ['stripped-html', 'body-html', 'body_html', 'html']) ?? null
    const receivedAt =
      firstValue(payload, ['Date', 'date']) ??
      new Date().toISOString()
    const inReplyTo =
      firstValue(payload, ['In-Reply-To', 'in-reply-to']) ??
      getHeaderFromMessageHeaders(payload, 'In-Reply-To')
    const references =
      firstValue(payload, ['References', 'references']) ??
      getHeaderFromMessageHeaders(payload, 'References')

    if (!parsedFrom.email) {
      return NextResponse.json({ ok: false, error: 'Inbound message is missing sender.' }, { status: 400 })
    }

    const { data: message, error: insertError } = await admin
      .from('mail_messages')
      .insert({
        company_id: thread.company_id,
        thread_id: thread.id,
        direction: 'inbound',
        from_email: parsedFrom.email,
        from_name: parsedFrom.name,
        to_email: toAddress.email || recipient,
        to_name: toAddress.name,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        provider: 'mailgun',
        provider_message_id: providerMessageId,
        mailgun_message_id: providerMessageId,
        in_reply_to: inReplyTo,
        references_header: references,
        recipient_email: recipient,
        received_at: receivedAt,
      })
      .select('id')
      .single()

    if (insertError || !message?.id) {
      throw new Error(insertError?.message ?? 'Inbound message could not be saved.')
    }

    const { error: threadUpdateError } = await admin
      .from('mail_threads')
      .update({
        last_message_at: receivedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', thread.id)

    if (threadUpdateError) throw new Error(threadUpdateError.message)

    await logMailEvent({
      companyId: thread.company_id,
      messageId: message.id,
      eventType: 'inbound_received',
      providerPayload: payload.raw,
    })

    return NextResponse.json({
      ok: true,
      matched: true,
      threadId: thread.id,
      messageId: message.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[MAILGUN] Inbound webhook failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
