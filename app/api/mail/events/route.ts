import { NextRequest, NextResponse } from 'next/server'

import { verifyMailgunSignature } from '@/lib/mail/mailgun-signature'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

type EventPayload = {
  raw: Record<string, unknown>
  get: (key: string) => string | null
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

async function readEventPayload(request: NextRequest): Promise<EventPayload> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return {
      raw: body,
      get: (key) => getString(body[key]) || null,
    }
  }

  const formData = await request.formData()
  const raw: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    raw[key] = typeof value === 'string' ? value : value.name
  }

  return {
    raw,
    get: (key) => {
      const value = formData.get(key)
      return typeof value === 'string' ? value.trim() : null
    },
  }
}

function getNestedString(value: unknown, path: string[]) {
  let current: unknown = value

  for (const key of path) {
    const record = asRecord(current)
    if (!record) return null
    current = record[key]
  }

  return getString(current) || null
}

function getEventData(payload: EventPayload) {
  const rawEventData = payload.raw['event-data']
  if (typeof rawEventData === 'string') {
    try {
      return JSON.parse(rawEventData) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  return asRecord(rawEventData) ?? asRecord(payload.raw.eventData) ?? payload.raw
}

function getSignatureValue(payload: EventPayload, key: 'timestamp' | 'token' | 'signature') {
  return (
    payload.get(key) ??
    payload.get(`signature[${key}]`) ??
    getNestedString(payload.raw.signature, [key])
  )
}

async function findMessage(providerMessageId: string | null) {
  if (!providerMessageId) return null

  const admin = createSupabaseAdminClient()
  const providerResponse = await admin
    .from('mail_messages')
    .select('id, company_id')
    .eq('provider', 'mailgun')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()

  if (providerResponse.error) throw new Error(providerResponse.error.message)
  if (providerResponse.data) return providerResponse.data as { id: string; company_id: string }

  const mailgunResponse = await admin
    .from('mail_messages')
    .select('id, company_id')
    .eq('provider', 'mailgun')
    .eq('mailgun_message_id', providerMessageId)
    .maybeSingle()

  if (mailgunResponse.error) throw new Error(mailgunResponse.error.message)

  return mailgunResponse.data as { id: string; company_id: string } | null
}

export async function POST(request: NextRequest) {
  try {
    const payload = await readEventPayload(request)
    const signatureOk = verifyMailgunSignature({
      timestamp: getSignatureValue(payload, 'timestamp'),
      token: getSignatureValue(payload, 'token'),
      signature: getSignatureValue(payload, 'signature'),
    })

    if (!signatureOk) {
      return NextResponse.json({ ok: false, error: 'Invalid Mailgun signature.' }, { status: 401 })
    }

    const eventData = getEventData(payload)
    const eventType = getNestedString(eventData, ['event']) ?? payload.get('event') ?? 'mailgun_event'
    const providerMessageId =
      getNestedString(eventData, ['message', 'headers', 'message-id']) ??
      getNestedString(eventData, ['message', 'id']) ??
      getNestedString(eventData, ['id']) ??
      payload.get('message-id')
    const message = await findMessage(providerMessageId)

    if (!message) {
      console.warn('[MAILGUN] Event without matching message', { eventType, providerMessageId })
      return NextResponse.json({ ok: true, matched: false })
    }

    const admin = createSupabaseAdminClient()
    const { error } = await admin.from('mail_events').insert({
      company_id: message.company_id,
      message_id: message.id,
      event_type: eventType,
      provider: 'mailgun',
      provider_payload: payload.raw,
    })

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, matched: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[MAILGUN] Event webhook failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
