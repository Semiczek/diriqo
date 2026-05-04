import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { InboundMessageRow, InboundMatchResult, NormalizedInboundPayload } from '@/lib/email/types'

type UpsertInboundMessageInput = {
  payload: NormalizedInboundPayload
  match: InboundMatchResult
  mailboxId: string
}

export async function upsertInboundMessage(input: UpsertInboundMessageInput): Promise<InboundMessageRow> {
  const supabase = createSupabaseAdminClient()

  if (input.payload.internetMessageId) {
    const existingResponse = await supabase
      .from('inbound_messages')
      .select(
        'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, from_email, from_name, to_email, cc, subject, html_body, text_body, internet_message_id, in_reply_to_message_id, references_header, provider, provider_message_id, matching_status, received_at, is_read, created_at',
      )
      .eq('internet_message_id', input.payload.internetMessageId)
      .maybeSingle()

    if (existingResponse.error) {
      throw new Error(`Nepodařilo se ověřit duplicitu inbound message: ${existingResponse.error.message}`)
    }

    if (existingResponse.data) {
      return existingResponse.data as InboundMessageRow
    }
  }

  const insertResponse = await supabase
    .from('inbound_messages')
    .insert({
      company_id: input.payload.companyId,
      mailbox_id: input.mailboxId,
      thread_id: input.match.threadId,
      related_entity_type: input.match.relatedEntityType,
      related_entity_id: input.match.relatedEntityId,
      customer_id: input.match.customerId,
      contact_id: input.match.contactId,
      from_email: input.payload.fromEmail,
      from_name: input.payload.fromName ?? null,
      to_email: input.payload.toEmail ?? null,
      cc: input.payload.cc ?? null,
      subject: input.payload.subject ?? null,
      html_body: input.payload.htmlBody ?? null,
      text_body: input.payload.textBody ?? null,
      internet_message_id: input.payload.internetMessageId ?? null,
      in_reply_to_message_id: input.payload.inReplyToMessageId ?? null,
      references_header: input.payload.referencesHeader ?? null,
      provider: input.payload.provider,
      provider_message_id: input.payload.providerMessageId ?? null,
      matching_status: input.match.matchingStatus,
      received_at: input.payload.receivedAt,
    })
    .select(
      'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, from_email, from_name, to_email, cc, subject, html_body, text_body, internet_message_id, in_reply_to_message_id, references_header, provider, provider_message_id, matching_status, received_at, is_read, created_at',
    )
    .single()

  if (insertResponse.error || !insertResponse.data) {
    throw new Error(`Nepodařilo se uložit inbound message: ${insertResponse.error?.message ?? 'unknown error'}`)
  }

  return insertResponse.data as InboundMessageRow
}
