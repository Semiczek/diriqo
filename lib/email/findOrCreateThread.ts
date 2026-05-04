import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { normalizeSubject } from '@/lib/email/normalizeSubject'
import type { FindOrCreateThreadInput, MessageThreadRow } from '@/lib/email/types'

export async function findOrCreateThread(
  input: FindOrCreateThreadInput,
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<MessageThreadRow> {
  const normalizedSubject = normalizeSubject(input.subject)

  const existingResponse = await supabase
    .from('message_threads')
    .select(
      'id, company_id, mailbox_id, related_entity_type, related_entity_id, customer_id, contact_id, subject_original, subject_normalized, status, has_unread_inbound, last_message_at, last_inbound_at, last_outbound_at',
    )
    .eq('company_id', input.companyId)
    .eq('mailbox_id', input.mailboxId)
    .eq('related_entity_type', input.relatedEntityType)
    .eq('related_entity_id', input.relatedEntityId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingResponse.error) {
    throw new Error(`Nepodařilo se načíst email thread: ${existingResponse.error.message}`)
  }

  if (existingResponse.data) {
    const existingThread = existingResponse.data as MessageThreadRow

    const { data: updatedThread, error: updateError } = await supabase
      .from('message_threads')
      .update({
        customer_id: input.customerId ?? existingThread.customer_id,
        contact_id: input.contactId ?? existingThread.contact_id,
        subject_original: input.subject ?? existingThread.subject_original,
        subject_normalized: normalizedSubject || existingThread.subject_normalized,
      })
      .eq('id', existingThread.id)
      .select(
        'id, company_id, mailbox_id, related_entity_type, related_entity_id, customer_id, contact_id, subject_original, subject_normalized, status, has_unread_inbound, last_message_at, last_inbound_at, last_outbound_at',
      )
      .single()

    if (updateError) {
      throw new Error(`Nepodařilo se aktualizovat email thread: ${updateError.message}`)
    }

    return updatedThread as MessageThreadRow
  }

  const createResponse = await supabase
    .from('message_threads')
    .insert({
      company_id: input.companyId,
      mailbox_id: input.mailboxId,
      related_entity_type: input.relatedEntityType,
      related_entity_id: input.relatedEntityId,
      customer_id: input.customerId ?? null,
      contact_id: input.contactId ?? null,
      subject_original: input.subject ?? null,
      subject_normalized: normalizedSubject || null,
      status: 'open',
    })
    .select(
      'id, company_id, mailbox_id, related_entity_type, related_entity_id, customer_id, contact_id, subject_original, subject_normalized, status, has_unread_inbound, last_message_at, last_inbound_at, last_outbound_at',
    )
    .single()

  if (createResponse.error || !createResponse.data) {
    throw new Error(`Nepodařilo se vytvořit email thread: ${createResponse.error?.message ?? 'unknown error'}`)
  }

  return createResponse.data as MessageThreadRow
}
