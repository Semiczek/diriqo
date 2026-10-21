import 'server-only'

import type { DalContext } from '@/lib/dal/auth'

export type QuotePublication = {
  quoteId: string
  shareToken: string
  state: 'captured' | 'legacy_unknown'
  capturedAt: string | null
}

export async function publishCoreQuoteCustomerIdentity(
  ctx: Pick<DalContext, 'supabase' | 'companyId'>,
  quoteId: string,
): Promise<QuotePublication> {
  const { data, error } = await ctx.supabase.rpc('publish_core_quote_customer_identity', {
    p_company_id: ctx.companyId,
    p_quote_id: quoteId,
  })
  if (error) {
    if (error.code === '42501') throw new Error('Nemáte oprávnění zpřístupnit tuto nabídku.')
    if (error.code === 'P0002') throw new Error('Nabídka nebyla nalezena v aktivní firmě.')
    throw new Error('Nabídku se nepodařilo připravit ke sdílení. Zkuste to znovu.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
    data.quoteId !== quoteId || typeof data.shareToken !== 'string' ||
    !data.shareToken.trim() || data.shareToken.length > 2048 ||
    !['captured', 'legacy_unknown'].includes(data.state) ||
    (data.state === 'captured' && (typeof data.capturedAt !== 'string' || !Number.isFinite(Date.parse(data.capturedAt)))) ||
    (data.state === 'legacy_unknown' && data.capturedAt !== null)) {
    throw new Error('Nepodařilo se potvrdit připravenost nabídky. Obnovte její detail.')
  }
  return data as QuotePublication
}
