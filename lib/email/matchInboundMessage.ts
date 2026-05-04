import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { extractTrackingTokenFromSubject, normalizeSubject } from '@/lib/email/normalizeSubject'
import type { InboundMatchResult, NormalizedInboundPayload, OutboundMessageRow } from '@/lib/email/types'

function parseMessageIds(value: string | null | undefined) {
  if (!value) return []
  return Array.from(new Set(value.match(/<[^>]+>/g) ?? []))
}

async function resolveOutboundMatchByInternetMessageId(
  companyId: string,
  internetMessageId: string,
): Promise<OutboundMessageRow | null> {
  const supabase = createSupabaseAdminClient()
  const response = await supabase
    .from('outbound_messages')
    .select(
      'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, message_type, to_email, to_name, cc, bcc, reply_to, subject_rendered, html_rendered, text_rendered, provider, provider_message_id, internet_message_id, tracking_token, status, error_code, error_message, triggered_by_user_id, triggered_automatically, sent_at, created_at',
    )
    .eq('company_id', companyId)
    .eq('internet_message_id', internetMessageId)
    .maybeSingle()

  if (response.error) {
    throw new Error(`Nepodařilo se dohledat outbound message: ${response.error.message}`)
  }

  return (response.data as OutboundMessageRow | null) ?? null
}

export async function matchInboundMessage(payload: NormalizedInboundPayload): Promise<InboundMatchResult> {
  const supabase = createSupabaseAdminClient()

  if (payload.inReplyToMessageId) {
    const outbound = await resolveOutboundMatchByInternetMessageId(payload.companyId, payload.inReplyToMessageId)
    if (outbound) {
      return {
        matchingStatus: 'matched',
        threadId: outbound.thread_id,
        relatedEntityType: outbound.related_entity_type,
        relatedEntityId: outbound.related_entity_id,
        customerId: outbound.customer_id,
        contactId: outbound.contact_id,
        mailboxId: outbound.mailbox_id,
        matchedBy: 'in_reply_to',
      }
    }
  }

  for (const referenceId of parseMessageIds(payload.referencesHeader)) {
    const outbound = await resolveOutboundMatchByInternetMessageId(payload.companyId, referenceId)
    if (outbound) {
      return {
        matchingStatus: 'matched',
        threadId: outbound.thread_id,
        relatedEntityType: outbound.related_entity_type,
        relatedEntityId: outbound.related_entity_id,
        customerId: outbound.customer_id,
        contactId: outbound.contact_id,
        mailboxId: outbound.mailbox_id,
        matchedBy: 'references',
      }
    }
  }

  const subjectToken = extractTrackingTokenFromSubject(payload.subject)
  if (subjectToken) {
    const outboundByToken = await supabase
      .from('outbound_messages')
      .select(
        'id, company_id, mailbox_id, thread_id, related_entity_type, related_entity_id, customer_id, contact_id, message_type, to_email, to_name, cc, bcc, reply_to, subject_rendered, html_rendered, text_rendered, provider, provider_message_id, internet_message_id, tracking_token, status, error_code, error_message, triggered_by_user_id, triggered_automatically, sent_at, created_at',
      )
      .eq('company_id', payload.companyId)
      .eq('tracking_token', subjectToken)
      .maybeSingle()

    if (outboundByToken.error) {
      throw new Error(`Nepodařilo se dohledat outbound message podle tokenu: ${outboundByToken.error.message}`)
    }

    if (outboundByToken.data) {
      const outbound = outboundByToken.data as OutboundMessageRow
      return {
        matchingStatus: 'fallback_matched',
        threadId: outbound.thread_id,
        relatedEntityType: outbound.related_entity_type,
        relatedEntityId: outbound.related_entity_id,
        customerId: outbound.customer_id,
        contactId: outbound.contact_id,
        mailboxId: outbound.mailbox_id,
        matchedBy: 'token',
      }
    }
  }

  const normalizedSubject = normalizeSubject(payload.subject)
  if (normalizedSubject) {
    const customerIdsResponse = await supabase
      .from('customers')
      .select('id')
      .eq('company_id', payload.companyId)
      .ilike('email', payload.fromEmail)

    if (customerIdsResponse.error) {
      throw new Error(`Nepodařilo se dohledat zákazníka podle e-mailu: ${customerIdsResponse.error.message}`)
    }

    const customerIds = (customerIdsResponse.data ?? []).map((item) => item.id as string)

    const contactIdsResponse = await supabase
      .from('customer_contacts')
      .select('id')
      .ilike('email', payload.fromEmail)

    if (contactIdsResponse.error) {
      throw new Error(`Nepodařilo se dohledat kontakt podle e-mailu: ${contactIdsResponse.error.message}`)
    }

    const contactIds = (contactIdsResponse.data ?? []).map((item) => item.id as string)

    if (customerIds.length > 0 || contactIds.length > 0) {
      let fallbackQuery = supabase
        .from('message_threads')
        .select(
          'id, company_id, mailbox_id, related_entity_type, related_entity_id, customer_id, contact_id, subject_original, subject_normalized, status, has_unread_inbound, last_message_at, last_inbound_at, last_outbound_at',
        )
        .eq('company_id', payload.companyId)
        .eq('subject_normalized', normalizedSubject)
        .gte('last_message_at', new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString())
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(5)

      if (customerIds.length > 0 && contactIds.length > 0) {
        fallbackQuery = fallbackQuery.or(
          `customer_id.in.(${customerIds.join(',')}),contact_id.in.(${contactIds.join(',')})`,
        )
      } else if (customerIds.length > 0) {
        fallbackQuery = fallbackQuery.in('customer_id', customerIds)
      } else {
        fallbackQuery = fallbackQuery.in('contact_id', contactIds)
      }

      const fallbackResponse = await fallbackQuery

      if (fallbackResponse.error) {
        throw new Error(`Nepodařilo se dohledat fallback thread: ${fallbackResponse.error.message}`)
      }

      const candidates = (fallbackResponse.data ?? []) as Array<{
        id: string
        mailbox_id: string
        related_entity_type: InboundMatchResult['relatedEntityType']
        related_entity_id: string
        customer_id: string | null
        contact_id: string | null
      }>

      if (candidates.length === 1) {
        const candidate = candidates[0]
        return {
          matchingStatus: 'fallback_matched',
          threadId: candidate.id,
          relatedEntityType: candidate.related_entity_type,
          relatedEntityId: candidate.related_entity_id,
          customerId: candidate.customer_id,
          contactId: candidate.contact_id,
          mailboxId: candidate.mailbox_id,
          matchedBy: 'fallback',
        }
      }
    }
  }

  return {
    matchingStatus: 'unmatched',
    threadId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    customerId: null,
    contactId: null,
    mailboxId: null,
    matchedBy: 'none',
  }
}
