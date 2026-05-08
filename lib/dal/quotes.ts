import 'server-only'

import { assertCustomerInCompany, TenantScopeError } from '@/lib/dal/companies'
import type { DalContext } from '@/lib/dal/auth'
import type { QuoteStatus } from '@/lib/quote-status'

export async function updateQuote(
  ctx: DalContext,
  input: {
    quoteId: string
    customerId: string
    title: string
    shareToken: string | null
    status: QuoteStatus
    quoteDate: string | null
    validUntil: string | null
    sentAt: string | null
    acceptedAt: string | null
    rejectedAt: string | null
  },
) {
  await assertCustomerInCompany(ctx, input.customerId)

  const { data: quote, error: quoteError } = await ctx.supabase
    .from('quotes')
    .select('id')
    .eq('id', input.quoteId)
    .eq('customer_id', input.customerId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (quoteError || !quote?.id) {
    throw new TenantScopeError('Nabidka nepatri do aktivni firmy.')
  }

  const { error } = await ctx.supabase
    .from('quotes')
    .update({
      title: input.title,
      share_token: input.shareToken,
      share_token_scope: input.shareToken ? 'quote_public_offer' : null,
      share_token_expires_at: input.shareToken
        ? input.validUntil
          ? `${input.validUntil}T23:59:59.999Z`
          : null
        : null,
      share_token_revoked_at: input.shareToken ? null : new Date().toISOString(),
      status: input.status,
      quote_date: input.quoteDate,
      valid_until: input.validUntil,
      sent_at: input.sentAt,
      accepted_at: input.acceptedAt,
      rejected_at: input.rejectedAt,
    })
    .eq('id', input.quoteId)
    .eq('company_id', ctx.companyId)

  if (error) throw error
}
