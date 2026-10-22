import 'server-only'
import type { PortalUserContext } from '@/lib/customer-portal/auth'
import { coreQuoteId } from '@/lib/core-quote-lifecycle'
import { isAllowedResponseActionType } from '@/lib/public-offer-security'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type PortalQuoteResponseInput = {
  expectedPortalUserId: string; quoteId: string; versionId: string; operationId: string
  actionType?: string; note?: string; decision?: 'accepted'; evidence?: string
}
export async function respondToPortalQuote(user: PortalUserContext, input: PortalQuoteResponseInput) {
  if (!input.expectedPortalUserId || input.expectedPortalUserId !== user.portalUserId || !user.companyId || (!input.decision && !isAllowedResponseActionType(input.actionType || ''))
    || (input.note?.length || 0) > 2000 || (input.decision && (!input.evidence?.trim() || input.evidence.length > 4000))) {
    throw new Error('Zkontrolujte verzi nabídky a obsah odpovědi.')
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('respond_portal_core_quote_version', {
    p_company_id: coreQuoteId(user.companyId), p_customer_id: coreQuoteId(user.customerId),
    p_quote_id: coreQuoteId(input.quoteId), p_version_id: coreQuoteId(input.versionId), p_operation_id: coreQuoteId(input.operationId),
    p_input: input.decision ? { decision: 'accepted', evidence: input.evidence!.trim() }
      : { action_type: input.actionType, note: input.note?.trim() || null },
  })
  if (error) throw new Error('Reakci nelze potvrdit. Ověřte platnost nabídky a přihlášení; opakujte stejný požadavek.')
  if (!data || data.success !== true || data.quoteId !== input.quoteId || data.versionId !== input.versionId || data.operationId !== input.operationId) {
    throw new Error('Výsledek reakce není potvrzený. Opakujte stejný požadavek.')
  }
  return data
}
