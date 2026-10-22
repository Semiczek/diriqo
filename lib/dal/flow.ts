import 'server-only'

import type { DalContext, SupabaseServerClient } from '@/lib/dal/auth'
import { issueInvoiceAtomic, type InvoiceIssueContext } from '@/lib/dal/invoices'
import { convertCoreQuoteToJobAtomic } from '@/lib/dal/core-quote-conversion'
import { createCoreQuoteFromCalculation } from '@/lib/dal/quotes'
import type { CoreQuoteConversionInput } from '@/lib/core-quote-conversion'
import type { CoreQuoteCreateInput } from '@/lib/core-quote-lifecycle'

type FlowContext = {
  supabase: Pick<SupabaseServerClient, 'from'>
  companyId: string
  profileId?: string | null
}

export async function createQuoteFromCalculation(ctx: DalContext, input: CoreQuoteCreateInput) {
  return createCoreQuoteFromCalculation(ctx, input)
}

export async function createJobFromQuote(ctx: DalContext, input: CoreQuoteConversionInput) {
  return convertCoreQuoteToJobAtomic(ctx, input)
}

export async function markJobCompleted(ctx: FlowContext, jobId: string) {
  const { error } = await ctx.supabase.from('jobs').update({ status: 'done', work_state: 'done' }).eq('id', jobId).eq('company_id', ctx.companyId)
  if (error) throw error
}

export async function markReadyForInvoice(ctx: FlowContext, jobId: string) {
  const { error } = await ctx.supabase.from('jobs').update({ billing_status: 'waiting_for_invoice', billing_state: 'waiting_for_invoice' }).eq('id', jobId).eq('company_id', ctx.companyId)
  if (error) throw error
}

export async function issueInvoice(ctx: InvoiceIssueContext, invoiceId: string) {
  const { issued, alreadyIssued } = await issueInvoiceAtomic(ctx, invoiceId)
  return { issued, alreadyIssued }
}
