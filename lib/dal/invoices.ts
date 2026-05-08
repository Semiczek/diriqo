import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import { TenantScopeError } from '@/lib/dal/companies'

export async function assertInvoiceInCompany(ctx: DalContext, invoiceId: string) {
  const { data, error } = await ctx.supabase
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (error || !data?.id) {
    throw new TenantScopeError('Faktura nepatri do aktivni firmy.')
  }
}
