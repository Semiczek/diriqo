import 'server-only'

import type { InvoiceIssueContext } from '@/lib/dal/invoices'

export type InvoiceSettlementInput = { invoiceId: string; expectedRevision: string }
export type InvoiceSettlementResult = {
  invoiceId: string
  status: 'paid' | 'cancelled'
  changed: boolean
  settledAt: string
  jobIds: string[]
}

export class InvoiceSettlementError extends Error {
  readonly reloadRequired = true

  constructor(message: string) {
    super(message)
    this.name = 'InvoiceSettlementError'
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revision = /^[0-9a-f]{64}$/

/** Only known tokens are displayed; provider messages/details may contain private data. */
export function invoiceSettlementError(error: { message?: string } | null): InvoiceSettlementError {
  switch (error?.message) {
    case 'INVOICE_SETTLEMENT_FORBIDDEN':
      return new InvoiceSettlementError('Ke změně úhrady nebo stavu faktury nemáte oprávnění. Ověřte přihlášení a aktivní firmu.')
    case 'INVOICE_SETTLEMENT_INPUT_INVALID':
      return new InvoiceSettlementError('Požadavek není platný. Načtěte aktuální fakturu před dalším pokusem.')
    case 'INVOICE_SETTLEMENT_STALE':
      return new InvoiceSettlementError('Fakturu mezitím někdo změnil. Načtěte její aktuální stav před označením úhrady nebo zrušením.')
    case 'INVOICE_NOT_FOUND':
      return new InvoiceSettlementError('Faktura nebyla v aktivní firmě nalezena.')
    case 'INVOICE_INVALID_STATE':
      return new InvoiceSettlementError('Fakturu v tomto stavu nelze označit jako zaplacenou ani zrušit. Načtěte její aktuální stav.')
    case 'INVOICE_CANCEL_PAID':
      return new InvoiceSettlementError('Zaplacenou fakturu nelze běžně zrušit. Úhradu je potřeba vyřešit samostatně.')
    case 'INVOICE_CANCEL_EXPORTED':
      return new InvoiceSettlementError('Exportovanou fakturu nelze běžně zrušit. Navazující opravu dokladu je potřeba vyřešit samostatně.')
    case 'INVOICE_LINK_SCOPE_INVALID':
    case 'INVOICE_LINK_CONFLICT':
    case 'INVOICE_SETTLEMENT_JOB_CONFLICT':
      return new InvoiceSettlementError('Změnil se stav nebo přiřazení souvisejících zakázek. Načtěte fakturu a zakázky znovu.')
    default:
      return new InvoiceSettlementError('Výsledek změny stavu faktury se nepodařilo potvrdit. Před dalším pokusem načtěte aktuální fakturu.')
  }
}

async function settleInvoiceAtomic(
  ctx: InvoiceIssueContext,
  input: InvoiceSettlementInput,
  targetStatus: 'paid' | 'cancelled',
): Promise<InvoiceSettlementResult> {
  if (typeof ctx.companyId !== 'string' || !uuid.test(ctx.companyId)
    || typeof input.invoiceId !== 'string' || !uuid.test(input.invoiceId)) {
    throw invoiceSettlementError({ message: 'INVOICE_NOT_FOUND' })
  }
  if (typeof input.expectedRevision !== 'string' || !revision.test(input.expectedRevision)) {
    throw invoiceSettlementError({ message: 'INVOICE_SETTLEMENT_INPUT_INVALID' })
  }

  try {
    const auth = await ctx.supabase.auth.getUser()
    if (auth.error || !auth.data.user) throw invoiceSettlementError({ message: 'INVOICE_SETTLEMENT_FORBIDDEN' })

    // Time, state transitions, link scope and job updates belong to this one transaction.
    const { data, error } = await ctx.supabase.rpc(targetStatus === 'paid' ? 'mark_invoice_paid_atomic' : 'cancel_invoice_atomic', {
      target_company_id: ctx.companyId.toLowerCase(),
      target_invoice_id: input.invoiceId.toLowerCase(),
      expected_revision: input.expectedRevision,
    })
    if (error) throw invoiceSettlementError(error)

    const timestamp = data?.[targetStatus === 'paid' ? 'paid_at' : 'cancelled_at']
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.invoice_id !== input.invoiceId.toLowerCase() || data.status !== targetStatus
      || typeof data.changed !== 'boolean'
      || typeof timestamp !== 'string' || !timestamp.trim() || !Number.isFinite(Date.parse(timestamp))
      || !Array.isArray(data.job_ids)
      || data.job_ids.some((id: unknown) => typeof id !== 'string' || !uuid.test(id))
      || new Set(data.job_ids.map((id: string) => id.toLowerCase())).size !== data.job_ids.length) {
      throw invoiceSettlementError(null)
    }
    return {
      invoiceId: data.invoice_id,
      status: targetStatus,
      changed: data.changed,
      settledAt: timestamp,
      jobIds: data.job_ids.map((id: string) => id.toLowerCase()),
    }
  } catch (error) {
    if (error instanceof InvoiceSettlementError) throw error
    // A lost response may follow COMMIT. Do not repeat the write or present success.
    throw invoiceSettlementError(null)
  }
}

export function markInvoicePaidAtomic(ctx: InvoiceIssueContext, input: InvoiceSettlementInput) {
  return settleInvoiceAtomic(ctx, input, 'paid')
}

export function cancelInvoiceAtomic(ctx: InvoiceIssueContext, input: InvoiceSettlementInput) {
  return settleInvoiceAtomic(ctx, input, 'cancelled')
}
