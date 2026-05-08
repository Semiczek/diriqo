import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { logMessageEvent } from '@/lib/email/logMessageEvent'
import { matchInboundMessage } from '@/lib/email/matchInboundMessage'
import { upsertInboundMessage } from '@/lib/email/upsertInboundMessage'
import type { NormalizedInboundPayload } from '@/lib/email/types'

export const runtime = 'nodejs'

function getInboundSecret() {
  const secret = process.env.MAIL_INBOUND_SHARED_SECRET?.trim()

  if (!secret) {
    throw new Error('Chybí MAIL_INBOUND_SHARED_SECRET.')
  }

  return secret
}

function hasValidInboundSecret(receivedSecret: string, expectedSecret: string) {
  const received = Buffer.from(receivedSecret)
  const expected = Buffer.from(expectedSecret)

  return received.length === expected.length && timingSafeEqual(received, expected)
}

async function updateThreadAfterInbound(
  threadId: string | null,
  receivedAt: string,
) {
  if (!threadId) return

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('message_threads')
    .update({
      has_unread_inbound: true,
      last_message_at: receivedAt,
      last_inbound_at: receivedAt,
      status: 'waiting_internal',
    })
    .eq('id', threadId)

  if (error) {
    throw new Error(`Nepodařilo se aktualizovat thread po inbound zprávě: ${error.message}`)
  }
}

async function resolveMailboxByAddress(companyId: string, mailboxEmail: string) {
  const supabase = createSupabaseAdminClient()
  const response = await supabase
    .from('mailboxes')
    .select('id, company_id, email_address')
    .eq('company_id', companyId)
    .ilike('email_address', mailboxEmail)
    .maybeSingle()

  if (response.error) {
    throw new Error(`Nepodařilo se najít mailbox: ${response.error.message}`)
  }

  return response.data
}

export async function POST(request: NextRequest) {
  try {
    const headerSecret = request.headers.get('x-inbound-secret')?.trim() ?? ''
    if (!hasValidInboundSecret(headerSecret, getInboundSecret())) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as NormalizedInboundPayload

    if (!payload.companyId || !payload.mailboxEmail || !payload.fromEmail || !payload.receivedAt) {
      return NextResponse.json({ ok: false, error: 'Invalid inbound payload.' }, { status: 400 })
    }

    const mailbox = await resolveMailboxByAddress(payload.companyId, payload.mailboxEmail)
    if (!mailbox?.id) {
      return NextResponse.json({ ok: false, error: 'Mailbox not found.' }, { status: 404 })
    }

    const match = await matchInboundMessage(payload)
    const inbound = await upsertInboundMessage({
      payload,
      match,
      mailboxId: mailbox.id,
    })

    await updateThreadAfterInbound(match.threadId, payload.receivedAt)

    await logMessageEvent({
      companyId: payload.companyId,
      threadId: match.threadId,
      inboundMessageId: inbound.id,
      eventType: 'inbound_received',
      providerEventId: payload.providerMessageId ?? null,
      note: 'Inbound email received through generic ingest endpoint.',
    })

    await logMessageEvent({
      companyId: payload.companyId,
      threadId: match.threadId,
      inboundMessageId: inbound.id,
      eventType:
        match.matchingStatus === 'matched'
          ? 'matched_to_thread'
          : match.matchingStatus === 'fallback_matched'
          ? 'fallback_matched_to_thread'
          : 'unmatched_inbound',
      note: `Inbound matching result: ${match.matchedBy}`,
    })

    return NextResponse.json({
      ok: true,
      inboundMessageId: inbound.id,
      matchingStatus: match.matchingStatus,
      threadId: match.threadId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[EMAIL] Generic inbound ingest failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
