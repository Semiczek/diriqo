import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type LogMessageEventInput = {
  companyId: string
  threadId?: string | null
  outboundMessageId?: string | null
  inboundMessageId?: string | null
  eventType: string
  providerEventId?: string | null
  providerPayload?: unknown
  note?: string | null
}

export async function logMessageEvent(
  input: LogMessageEventInput,
  supabase: SupabaseClient = createSupabaseAdminClient(),
) {

  const { error } = await supabase.from('message_events').insert({
    company_id: input.companyId,
    thread_id: input.threadId ?? null,
    outbound_message_id: input.outboundMessageId ?? null,
    inbound_message_id: input.inboundMessageId ?? null,
    event_type: input.eventType,
    provider_event_id: input.providerEventId ?? null,
    provider_payload: input.providerPayload ?? null,
    note: input.note ?? null,
  })

  if (error) {
    console.error('[EMAIL] Failed to log message event', {
      error: error.message,
      eventType: input.eventType,
      companyId: input.companyId,
    })
  }
}
