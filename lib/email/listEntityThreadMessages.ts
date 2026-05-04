import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPreview, htmlToText } from '@/lib/email/messageContent'
import type { MessageFeedItem, RelatedEntityType } from './types'

type ThreadRow = {
  id: string
  related_entity_type: RelatedEntityType
  related_entity_id: string
}

type OutboundRow = {
  id: string
  thread_id: string
  mailbox_id: string
  to_email: string
  to_name: string | null
  subject_rendered: string | null
  text_rendered: string | null
  html_rendered: string | null
  status: string | null
  triggered_by_user_id: string | null
  sent_at: string | null
  created_at: string
}

type InboundRow = {
  id: string
  thread_id: string | null
  from_email: string
  from_name: string | null
  subject: string | null
  text_body: string | null
  html_body: string | null
  matching_status: string | null
  received_at: string
}

type MailboxRow = {
  id: string
  email_address: string | null
  name: string | null
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
  const threadsResponse = await supabase
    .from('message_threads')
    .select('id, related_entity_type, related_entity_id')
    .eq('company_id', companyId)
    .eq('related_entity_type', relatedEntityType)
    .eq('related_entity_id', relatedEntityId)
    .order('last_message_at', { ascending: true, nullsFirst: false })

  if (threadsResponse.error) {
    throw new Error(`Nepodařilo se načíst komunikační vlákna: ${threadsResponse.error.message}`)
  }

  const threads = (threadsResponse.data ?? []) as ThreadRow[]
  const threadIds = threads.map((thread) => thread.id)

  if (threadIds.length === 0) {
    return {
      threads: [],
      feedItems: [] as MessageFeedItem[],
    }
  }

  const [outboundResponse, inboundResponse] = await Promise.all([
    supabase
      .from('outbound_messages')
      .select(
        'id, thread_id, mailbox_id, to_email, to_name, subject_rendered, text_rendered, html_rendered, status, triggered_by_user_id, sent_at, created_at'
      )
      .eq('company_id', companyId)
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('inbound_messages')
      .select(
        'id, thread_id, from_email, from_name, subject, text_body, html_body, matching_status, received_at'
      )
      .eq('company_id', companyId)
      .in('thread_id', threadIds)
      .order('received_at', { ascending: true }),
  ])

  if (outboundResponse.error) {
    throw new Error(`Nepodařilo se načíst odchozí emaily: ${outboundResponse.error.message}`)
  }

  if (inboundResponse.error) {
    throw new Error(`Nepodařilo se načíst příchozí emaily: ${inboundResponse.error.message}`)
  }

  const outboundRows = (outboundResponse.data ?? []) as OutboundRow[]
  const inboundRows = (inboundResponse.data ?? []) as InboundRow[]
  const mailboxIds = Array.from(
    new Set(outboundRows.map((message) => message.mailbox_id).filter((value): value is string => Boolean(value))),
  )
  const senderProfileIds = Array.from(
    new Set(
      outboundRows
        .map((message) => message.triggered_by_user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const [mailboxesResponse, profilesResponse] = await Promise.all([
    mailboxIds.length > 0
      ? supabase
          .from('mailboxes')
          .select('id, email_address, name')
          .eq('company_id', companyId)
          .in('id', mailboxIds)
      : Promise.resolve({ data: [], error: null }),
    senderProfileIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', senderProfileIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (mailboxesResponse.error) {
    throw new Error(`Nepodařilo se načíst mailboxy: ${mailboxesResponse.error.message}`)
  }

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst profily odesílatelů: ${profilesResponse.error.message}`)
  }

  const mailboxesById = new Map(
    ((mailboxesResponse.data ?? []) as MailboxRow[]).map((mailbox) => [mailbox.id, mailbox]),
  )
  const profilesById = new Map(
    ((profilesResponse.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  )

  const feedItems: MessageFeedItem[] = [
    ...outboundRows.map((message) => {
      const mailbox = mailboxesById.get(message.mailbox_id)
      const senderProfile = message.triggered_by_user_id
        ? profilesById.get(message.triggered_by_user_id)
        : null
      const bodyText = message.text_rendered?.trim() || htmlToText(message.html_rendered)

      return {
        id: message.id,
        threadId: message.thread_id,
        direction: 'outbound' as const,
        email: message.to_email,
        name: message.to_name ?? null,
        senderEmail: mailbox?.email_address ?? null,
        senderName: senderProfile?.full_name?.trim() || mailbox?.name?.trim() || null,
        senderProfileId: message.triggered_by_user_id ?? null,
        subject: message.subject_rendered ?? '',
        preview: buildPreview(message.text_rendered, message.html_rendered),
        bodyText,
        bodyHtml: message.html_rendered ?? null,
        status: message.status ?? 'queued',
        happenedAt: message.sent_at ?? message.created_at,
      }
    }),
    ...inboundRows.map((message) => {
      const bodyText = message.text_body?.trim() || htmlToText(message.html_body)

      return {
        id: message.id,
        threadId: message.thread_id ?? '',
        direction: 'inbound' as const,
        email: message.from_email,
        name: message.from_name ?? null,
        senderEmail: message.from_email,
        senderName: message.from_name ?? null,
        senderProfileId: null,
        subject: message.subject ?? '',
        preview: buildPreview(message.text_body, message.html_body),
        bodyText,
        bodyHtml: message.html_body ?? null,
        status: message.matching_status ?? 'matched',
        happenedAt: message.received_at,
      }
    }),
  ].sort((a, b) => {
    const left = new Date(a.happenedAt).getTime()
    const right = new Date(b.happenedAt).getTime()
    return left - right
  })

  return {
    threads,
    feedItems,
  }
}
