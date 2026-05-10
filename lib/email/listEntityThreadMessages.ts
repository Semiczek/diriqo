import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPreview, htmlToText } from '@/lib/email/messageContent'
import type { MessageFeedItem, RelatedEntityType } from './types'

type ThreadRow = {
  id: string
  company_id: string
  customer_id: string | null
  job_id: string | null
  offer_id: string | null
  subject: string
  thread_key: string
  last_message_at: string | null
}

type MessageRow = {
  id: string
  thread_id: string
  direction: 'outbound' | 'inbound'
  from_email: string
  from_name: string | null
  to_email: string
  to_name: string | null
  subject: string
  body_text: string | null
  body_html: string | null
  provider_message_id: string | null
  mailgun_message_id: string | null
  sent_by: string | null
  received_at: string | null
  sent_at: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  full_name: string | null
}

export async function listEntityThreadMessages(
  supabase: SupabaseClient,
  companyId: string,
  relatedEntityType: RelatedEntityType,
  relatedEntityId: string
) {
  let threadsQuery = supabase
    .from('mail_threads')
    .select('id, company_id, customer_id, job_id, offer_id, subject, thread_key, last_message_at')
    .eq('company_id', companyId)
    .order('last_message_at', { ascending: true, nullsFirst: false })

  if (relatedEntityType === 'job') {
    threadsQuery = threadsQuery.eq('job_id', relatedEntityId)
  } else if (relatedEntityType === 'customer') {
    threadsQuery = threadsQuery.eq('customer_id', relatedEntityId)
  } else if (relatedEntityType === 'offer') {
    threadsQuery = threadsQuery.eq('offer_id', relatedEntityId)
  } else {
    threadsQuery = threadsQuery.eq('id', '__unsupported_entity__')
  }

  const threadsResponse = await threadsQuery

  if (threadsResponse.error) {
    throw new Error(`Nepodařilo se načíst komunikační vlákna: ${threadsResponse.error.message}`)
  }

  const threads = (threadsResponse.data ?? []) as ThreadRow[]
  const threadIds = threads.map((thread) => thread.id)

  if (threadIds.length === 0) {
    return {
      threads,
      feedItems: [] as MessageFeedItem[],
    }
  }

  const messagesResponse = await supabase
    .from('mail_messages')
    .select(
      'id, thread_id, direction, from_email, from_name, to_email, to_name, subject, body_text, body_html, provider_message_id, mailgun_message_id, sent_by, received_at, sent_at, created_at'
    )
    .eq('company_id', companyId)
    .in('thread_id', threadIds)
    .order('created_at', { ascending: true })

  if (messagesResponse.error) {
    throw new Error(`Nepodařilo se načíst e-maily: ${messagesResponse.error.message}`)
  }

  const messages = (messagesResponse.data ?? []) as MessageRow[]
  const senderProfileIds = Array.from(
    new Set(messages.map((message) => message.sent_by).filter((value): value is string => Boolean(value)))
  )
  const profilesResponse =
    senderProfileIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', senderProfileIds)
      : { data: [], error: null }

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst profily odesílatelů: ${profilesResponse.error.message}`)
  }

  const profilesById = new Map(
    ((profilesResponse.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  )

  const feedItems: MessageFeedItem[] = messages
    .map((message) => {
      const bodyText = message.body_text?.trim() || htmlToText(message.body_html)
      const senderProfile = message.sent_by ? profilesById.get(message.sent_by) : null
      const happenedAt = message.direction === 'inbound'
        ? message.received_at ?? message.created_at
        : message.sent_at ?? message.created_at

      return {
        id: message.id,
        threadId: message.thread_id,
        direction: message.direction,
        email: message.direction === 'inbound' ? message.from_email : message.to_email,
        name: message.direction === 'inbound' ? message.from_name : message.to_name,
        senderEmail: message.direction === 'inbound' ? message.from_email : message.from_email,
        senderName: message.direction === 'inbound'
          ? message.from_name
          : senderProfile?.full_name?.trim() || message.from_name,
        senderProfileId: message.sent_by,
        subject: message.subject,
        preview: buildPreview(message.body_text, message.body_html),
        bodyText,
        bodyHtml: message.body_html,
        status: message.direction === 'inbound'
          ? 'matched'
          : message.sent_at
            ? 'sent'
            : 'queued',
        happenedAt,
      }
    })
    .sort((a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime())

  return {
    threads,
    feedItems,
  }
}
