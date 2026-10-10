import 'server-only'

import type { InvoiceIssueContext } from '@/lib/dal/invoices'

export type InvoiceDraftInput = {
  customerId: string
  jobIds: string[]
  issueDate: string
  taxableSupplyDate: string
  dueDate: string
  vatRate: number
  note: string | null
  requestId: string
}

export type InvoiceDraftResult = {
  invoiceId: string
  status: 'draft' | 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  created: boolean
}

export class InvoiceDraftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceDraftError'
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unknownOutcome = 'Uložení konceptu se nepodařilo potvrdit. Zkuste znovu odeslat stejný formulář; opakování nevytvoří druhou fakturu.'

function validDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function invoiceDraftWriteError(error: { message?: string } | null): InvoiceDraftError {
  switch (error?.message) {
    case 'INVOICE_MODULE_REQUIRED':
      return new InvoiceDraftError('Pro vytvoření faktury je potřeba aktivní modul Fakturace a základ Diriqo nebo DiriPOS.')
    case 'INVOICE_DRAFT_FORBIDDEN':
    case 'INVOICE_CREATE_FORBIDDEN':
    case 'INVOICE_ISSUE_FORBIDDEN':
      return new InvoiceDraftError('K vytvoření faktury nemáte oprávnění. Obnovte přihlášení a ověřte aktivní firmu.')
    case 'INVOICE_DRAFT_REQUEST_CONFLICT':
    case 'INVOICE_REQUEST_CONFLICT':
      return new InvoiceDraftError('Tento formulář už byl odeslán s jinými údaji. Otevřete přehled faktur a zkontrolujte vytvořený koncept.')
    case 'INVOICE_DRAFT_REQUEST_GONE':
      return new InvoiceDraftError('Koncept z tohoto formuláře už byl smazán. Pro nový koncept znovu otevřete tvorbu faktury.')
    case 'INVOICE_LINK_CONFLICT':
      return new InvoiceDraftError('Některá zakázka už je propojená s jinou fakturou. Obnovte přehled faktur.')
    case 'INVOICE_LINK_SCOPE_INVALID':
    case 'INVOICE_DRAFT_SCOPE_INVALID':
      return new InvoiceDraftError('Vybraný zákazník nebo zakázka nepatří do aktivní firmy. Obnovte formulář.')
    case 'INVOICE_DRAFT_JOBS_INVALID':
    case 'INVOICE_JOBS_INVALID':
      return new InvoiceDraftError('Vyberte dokončené zakázky s kladnou cenou. Některá vybraná zakázka se změnila.')
    case 'INVOICE_DRAFT_INPUT_INVALID':
    case 'INVOICE_CREATE_INVALID':
      return new InvoiceDraftError('Zkontrolujte vybrané zakázky, platná data, sazbu DPH a délku poznámky.')
    default:
      return new InvoiceDraftError(unknownOutcome)
  }
}

/** Only selections reach the database; prices, snapshots and licence checks are authoritative there. */
export async function createInvoiceFromJobsAtomic(ctx: InvoiceIssueContext, input: InvoiceDraftInput): Promise<InvoiceDraftResult> {
  if (typeof ctx.companyId !== 'string' || !uuid.test(ctx.companyId)
    || typeof input.customerId !== 'string' || !uuid.test(input.customerId)) {
    throw invoiceDraftWriteError({ message: 'INVOICE_DRAFT_SCOPE_INVALID' })
  }
  if (typeof input.requestId !== 'string' || !uuid.test(input.requestId)) {
    throw new InvoiceDraftError('Formulář není platný. Obnovte stránku před vytvořením konceptu.')
  }
  if (!Array.isArray(input.jobIds) || input.jobIds.length < 1 || input.jobIds.length > 200
    || input.jobIds.some((id) => typeof id !== 'string' || !uuid.test(id))) {
    throw new InvoiceDraftError('Vyberte 1 až 200 platných zakázek pro jednu fakturu.')
  }
  const jobIds = input.jobIds.map((id) => id.toLowerCase()).sort()
  if (new Set(jobIds).size !== jobIds.length) throw new InvoiceDraftError('Každou zakázku lze vybrat pouze jednou.')
  if (![input.issueDate, input.taxableSupplyDate, input.dueDate].every(validDate)
    || input.dueDate < input.issueDate) {
    throw new InvoiceDraftError('Vyplňte platná data. Splatnost nesmí předcházet datu vystavení.')
  }
  if (typeof input.vatRate !== 'number' || !Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100
    || Math.abs(input.vatRate * 100 - Math.round(input.vatRate * 100)) > 1e-9) {
    throw new InvoiceDraftError('Sazba DPH musí být mezi 0 a 100 % s nejvýše dvěma desetinnými místy.')
  }
  if (input.note !== null && (typeof input.note !== 'string' || [...input.note].length > 10000)) {
    throw new InvoiceDraftError('Poznámka smí mít nejvýše 10 000 znaků.')
  }

  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw invoiceDraftWriteError({ message: 'INVOICE_DRAFT_FORBIDDEN' })

  // Do not retry an unknown write automatically. A user retry keeps the original request ID.
  const { data, error } = await ctx.supabase.rpc('create_invoice_from_jobs_atomic', {
    target_company_id: ctx.companyId.toLowerCase(),
    target_customer_id: input.customerId.toLowerCase(),
    target_job_ids: jobIds,
    target_issue_date: input.issueDate,
    target_taxable_supply_date: input.taxableSupplyDate,
    target_due_date: input.dueDate,
    target_vat_rate: input.vatRate,
    target_note: input.note?.trim() || null,
    target_request_id: input.requestId.toLowerCase(),
  })
  if (error) throw invoiceDraftWriteError(error)
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.invoice_id !== 'string' || !uuid.test(data.invoice_id)
    || typeof data.created !== 'boolean'
    || !['draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'].includes(data.status)
    || (data.created && data.status !== 'draft')) throw invoiceDraftWriteError(null)
  return { invoiceId: data.invoice_id.toLowerCase(), status: data.status, created: data.created }
}
