import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { coreQuoteId } from '@/lib/core-quote-lifecycle'
export type QuoteDeliveryScope = { companyId: string; quoteId: string; versionId: string; operationId: string }
export type QuoteDelivery = QuoteDeliveryScope & { deliveryId: string; state: 'reserved' | 'sent' | 'uncertain'; canSend: boolean; attemptToken: string | null; shareToken: string | null }
export async function beginQuoteDelivery(client: SupabaseClient, scope: QuoteDeliveryScope, input: {
  to_email: string; to_name: string | null; subject: string; body_text: string; body_html: string | null; thread_id: string | null
}): Promise<QuoteDelivery> {
  const { data, error } = await client.rpc('begin_core_quote_delivery_atomic', {
    p_company_id: coreQuoteId(scope.companyId), p_quote_id: coreQuoteId(scope.quoteId),
    p_version_id: coreQuoteId(scope.versionId), p_operation_id: coreQuoteId(scope.operationId), p_input: input,
  })
  if (error) throw new Error('Odeslání této verze nabídky nelze připravit. Ověřte oprávnění a aktuální stav nabídky.')
  if (!data || Object.entries(scope).some(([key, value]) => data[key] !== value)
    || !['reserved', 'sent', 'uncertain'].includes(data.state) || typeof data.canSend !== 'boolean'
    || (data.canSend && (data.state !== 'reserved' || typeof data.attemptToken !== 'string' || data.attemptToken.length < 32
      || typeof data.shareToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.shareToken)))) {
    throw new Error('Výsledek přípravy odeslání není potvrzený. Ověřte stejný požadavek.')
  }
  return { ...scope, deliveryId: coreQuoteId(data.deliveryId), state: data.state, canSend: data.canSend,
    attemptToken: data.canSend ? data.attemptToken : null, shareToken: data.shareToken || null }
}
export async function finishQuoteDelivery(admin: SupabaseClient, delivery: QuoteDelivery, state: 'sent' | 'uncertain', providerMessageId: string | null = null) {
  if (!delivery.attemptToken) throw new Error('Chybí potvrzení pokusu o odeslání.')
  const { data, error } = await admin.rpc('complete_core_quote_delivery_atomic', {
    p_delivery_id: delivery.deliveryId, p_attempt_token: delivery.attemptToken, p_state: state, p_provider_message_id: providerMessageId,
  })
  if (error || !data || data.state !== state) throw new Error('Stav doručení se nepodařilo potvrdit.')
}
export function quoteDeliveryResponse(delivery: QuoteDelivery, state = delivery.state) {
  return { ok: state === 'sent', companyId: delivery.companyId, quoteId: delivery.quoteId,
    versionId: delivery.versionId, operationId: delivery.operationId, deliveryId: delivery.deliveryId,
    deliveryState: state, retryable: false,
    ...(state === 'sent' ? {} : { error: 'Výsledek odeslání zatím není potvrzený. Znovu ověřte stejný požadavek; další zpráva se automaticky neposílá.' }),
  }
}
