import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import { TenantScopeError } from '@/lib/dal/companies'

export type InvoiceIssueContext = {
  companyId: string
  supabase: Pick<DalContext['supabase'], 'auth' | 'rpc'>
}

export type InvoiceIssueResult = {
  invoiceId: string
  invoiceNumber: string
  status: 'issued' | 'sent' | 'paid' | 'overdue'
  issued: boolean
  alreadyIssued: boolean
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keep private database details out of the user-facing action error. */
export function invoiceWriteError(error: { message?: string } | null): Error {
  switch (error?.message) {
    case 'INVOICE_MODULE_REQUIRED':
      return new Error('Pro vytvoření a vystavení faktury je potřeba aktivní modul Fakturace a základ Diriqo nebo DiriPOS.')
    case 'INVOICE_ISSUE_FORBIDDEN':
      return new Error('K vystavení faktury nemáte oprávnění. Obnovte přihlášení a ověřte aktivní firmu.')
    case 'INVOICE_NOT_FOUND':
      return new TenantScopeError('Faktura nebyla v aktivní firmě nalezena.')
    case 'INVOICE_INVALID_STATE':
      return new Error('Fakturu v tomto stavu nelze vystavit. Obnovte stránku.')
    case 'INVOICE_LINK_SCOPE_INVALID':
      return new Error('Faktura obsahuje neplatnou vazbu na zákazníka nebo zakázku.')
    case 'INVOICE_LINK_CONFLICT':
      return new Error('Některá zakázka už je propojená s jinou fakturou. Obnovte stránku.')
    case 'INVOICE_NUMBER_CONFLICT':
      return new Error('Toto číslo faktury už v aktivní firmě existuje.')
    default:
      return new Error('Vystavení faktury se nepodařilo potvrdit. Obnovte stránku před opakováním akce.')
  }
}

/** The database checks membership/licence, locks the invoice and commits its jobs together. */
export async function issueInvoiceAtomic(ctx: InvoiceIssueContext, invoiceId: string): Promise<InvoiceIssueResult> {
  if (typeof ctx.companyId !== 'string' || typeof invoiceId !== 'string'
    || !uuid.test(ctx.companyId) || !uuid.test(invoiceId)) {
    throw new TenantScopeError('Faktura nebyla v aktivní firmě nalezena.')
  }
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw invoiceWriteError({ message: 'INVOICE_ISSUE_FORBIDDEN' })

  const { data, error } = await ctx.supabase.rpc('issue_invoice_atomic', {
    target_company_id: ctx.companyId.toLowerCase(),
    target_invoice_id: invoiceId.toLowerCase(),
  })
  if (error) throw invoiceWriteError(error)
  // An unavailable/mismatched result is never reported as success or retried automatically.
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || data.invoice_id !== invoiceId.toLowerCase() || typeof data.issued !== 'boolean'
    || typeof data.invoice_number !== 'string' || !data.invoice_number.trim()
    || !['issued', 'sent', 'paid', 'overdue'].includes(data.status)
    || (data.issued && data.status !== 'issued')) throw invoiceWriteError(null)

  return {
    invoiceId: data.invoice_id,
    invoiceNumber: data.invoice_number,
    status: data.status,
    issued: data.issued,
    alreadyIssued: !data.issued,
  }
}

/** Row lock and all dependent deletes are in one transaction; issued documents are retained. */
export async function deleteInvoiceDraftAtomic(ctx: InvoiceIssueContext, invoiceId: string): Promise<void> {
  if (typeof ctx.companyId !== 'string' || typeof invoiceId !== 'string'
    || !uuid.test(ctx.companyId) || !uuid.test(invoiceId)) {
    throw new TenantScopeError('Faktura nebyla v aktivní firmě nalezena.')
  }
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw new Error('Ke smazání konceptu nemáte oprávnění.')
  const { data, error } = await ctx.supabase.rpc('delete_invoice_draft_atomic', {
    target_company_id: ctx.companyId.toLowerCase(), target_invoice_id: invoiceId.toLowerCase(),
  })
  if (error?.message === 'INVOICE_DELETE_FORBIDDEN') {
    throw new Error('Smazat lze pouze nevystavený a neexportovaný koncept. Ostatní doklady zůstávají v historii.')
  }
  if (error || !data || data.invoice_id !== invoiceId.toLowerCase() || data.deleted !== true) {
    throw new Error('Smazání konceptu se nepodařilo potvrdit. Obnovte stránku před opakováním akce.')
  }
}

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
