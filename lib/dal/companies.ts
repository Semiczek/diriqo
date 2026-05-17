import 'server-only'

import type { DalContext } from '@/lib/dal/auth'

export class TenantScopeError extends Error {
  constructor(message = 'Zaznam nepatri do aktivni firmy.') {
    super(message)
    this.name = 'TenantScopeError'
  }
}

export async function assertCustomerInCompany(ctx: DalContext, customerId: string) {
  const { data, error } = await ctx.supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (error || !data?.id) {
    throw new TenantScopeError('Zakaznik nepatri do aktivni firmy.')
  }
}

export async function assertProfileInCompany(ctx: DalContext, profileId: string) {
  const { data, error } = await ctx.supabase
    .from('company_members')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data?.id) {
  throw new TenantScopeError('Pracovník nepatří do aktivní firmy.')
  }
}
