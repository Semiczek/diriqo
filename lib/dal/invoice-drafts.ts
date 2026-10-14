import 'server-only'

import { invoiceNumberConflictError, type InvoiceIssueContext, type InvoiceIssueResult } from '@/lib/dal/invoices'

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

export type InvoiceDraftEditIdentity = {
  invoiceId: string
  expectedRevision: string
  expectedItemIds: string[]
}

export type InvoiceDraftEditInput = InvoiceDraftEditIdentity & {
  header: {
    invoiceNumber: string | null
    variableSymbol: string | null
    issueDate: string
    taxableSupplyDate: string
    dueDate: string
    note: string | null
    supplier: Record<string, string | null>
    customer: Record<string, string | null>
  }
  items: Array<{
    id: string; itemName: string; description: string | null; quantity: string
    unit: string | null; unitPriceWithoutVat: string; vatRate: string
  }>
}

export class InvoiceDraftEditError extends Error {
  constructor(message: string, public readonly reloadRequired = false) {
    super(message)
    this.name = 'InvoiceDraftEditError'
  }
}

const revisionPattern = /^[0-9a-f]{64}$/
const editUnknown = 'Výsledek změny faktury se nepodařilo potvrdit. Před dalším pokusem načtěte aktuální fakturu.'

export function invoiceDraftEditError(error: { message?: string; code?: string } | null): InvoiceDraftEditError {
  const conflict = invoiceNumberConflictError(error)
  if (conflict) return new InvoiceDraftEditError(conflict.message)
  switch (error?.message) {
    case 'INVOICE_DRAFT_STALE':
      return new InvoiceDraftEditError('Fakturu mezitím někdo změnil. Vaše rozepsané údaje zůstaly ve formuláři. Načtěte aktuální fakturu a změny porovnejte.', true)
    case 'INVOICE_DRAFT_FORBIDDEN':
    case 'INVOICE_ISSUE_FORBIDDEN':
      return new InvoiceDraftEditError('Ke změně faktury nemáte oprávnění. Ověřte přihlášení a aktivní firmu.', true)
    case 'INVOICE_NOT_FOUND':
      return new InvoiceDraftEditError('Faktura nebyla v aktivní firmě nalezena.', true)
    case 'INVOICE_MODULE_REQUIRED':
      return new InvoiceDraftEditError('Pro tuto změnu je potřeba aktivní modul Fakturace a základ Diriqo nebo DiriPOS.', true)
    case 'INVOICE_INVALID_STATE':
      return new InvoiceDraftEditError('Faktura už není upravitelný koncept. Načtěte její aktuální stav.', true)
    case 'INVOICE_DRAFT_ITEMS_INVALID':
      return new InvoiceDraftEditError('Seznam položek neodpovídá načtené faktuře. Načtěte aktuální fakturu.', true)
    case 'INVOICE_DRAFT_INPUT_INVALID':
      return new InvoiceDraftEditError('Zkontrolujte data, názvy položek a platné kladné množství. Ceny a DPH musí být nezáporná desetinná čísla.')
    case 'INVOICE_LINK_SCOPE_INVALID':
    case 'INVOICE_LINK_CONFLICT':
      return new InvoiceDraftEditError('Změnila se vazba faktury na zákazníka nebo zakázku. Načtěte aktuální fakturu.', true)
    default:
      return new InvoiceDraftEditError(editUnknown, true)
  }
}

function assertEditIdentity(ctx: InvoiceIssueContext, input: Pick<InvoiceDraftEditIdentity, 'invoiceId' | 'expectedRevision'>) {
  if (!uuid.test(ctx.companyId) || !uuid.test(input.invoiceId)) throw invoiceDraftEditError({ message: 'INVOICE_NOT_FOUND' })
  if (!revisionPattern.test(input.expectedRevision)) throw invoiceDraftEditError({ message: 'INVOICE_DRAFT_STALE' })
}

function assertEditItems(ids: string[]) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200
    || ids.some((id) => typeof id !== 'string' || !uuid.test(id))
    || new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    throw invoiceDraftEditError({ message: 'INVOICE_DRAFT_ITEMS_INVALID' })
  }
}

async function editRpc(ctx: InvoiceIssueContext, name: string, args: Record<string, unknown>) {
  try {
    const auth = await ctx.supabase.auth.getUser()
    if (auth.error || !auth.data.user) throw invoiceDraftEditError({ message: 'INVOICE_DRAFT_FORBIDDEN' })
    const result = await ctx.supabase.rpc(name, args)
    if (result.error) throw invoiceDraftEditError(result.error)
    return result.data
  } catch (error) {
    if (error instanceof InvoiceDraftEditError) throw error
    // Transport failures can happen after COMMIT. Never retry or claim success here.
    throw invoiceDraftEditError(null)
  }
}

export async function getInvoiceEditSnapshot(ctx: InvoiceIssueContext, invoiceId: string): Promise<{
  invoice: Record<string, unknown> & { id: string; company_id: string }
  items: Array<Record<string, unknown> & { id: string; invoice_id: string; company_id: string }>
  revision: string
} | null> {
  if (!uuid.test(ctx.companyId) || !uuid.test(invoiceId)) return null
  let data
  try {
    data = await editRpc(ctx, 'get_invoice_edit_snapshot', {
      target_company_id: ctx.companyId.toLowerCase(), target_invoice_id: invoiceId.toLowerCase(),
    })
  } catch (error) {
    if (error instanceof InvoiceDraftEditError && error.message === 'Faktura nebyla v aktivní firmě nalezena.') return null
    throw error
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.revision !== 'string' || !revisionPattern.test(data.revision)
    || !data.invoice || typeof data.invoice !== 'object' || Array.isArray(data.invoice)
    || data.invoice.id !== invoiceId.toLowerCase() || data.invoice.company_id !== ctx.companyId.toLowerCase()
    || !Array.isArray(data.items)
    || data.items.some((item: Record<string, unknown>) => !item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !uuid.test(item.id) || item.invoice_id !== invoiceId.toLowerCase()
      || item.company_id !== ctx.companyId.toLowerCase())
    || new Set(data.items.map((item: { id: string }) => item.id)).size !== data.items.length) throw invoiceDraftEditError(null)
  return data
}

function draftEditResult(data: unknown, invoiceId: string): { invoiceId: string; revision: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invoiceDraftEditError(null)
  const result = data as Record<string, unknown>
  if (result.invoice_id !== invoiceId.toLowerCase() || result.status !== 'draft' || result.updated !== true
    || typeof result.revision !== 'string' || !revisionPattern.test(result.revision)) throw invoiceDraftEditError(null)
  return { invoiceId: result.invoice_id as string, revision: result.revision }
}

export async function updateInvoiceDraftAtomic(ctx: InvoiceIssueContext, input: InvoiceDraftEditInput) {
  assertEditIdentity(ctx, input)
  assertEditItems(input.expectedItemIds)
  if (!Array.isArray(input.items) || input.items.length !== input.expectedItemIds.length
    || input.items.some((item, index) => item.id !== input.expectedItemIds[index]
      || ![item.quantity, item.unitPriceWithoutVat, item.vatRate].every(value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)))) {
    throw invoiceDraftEditError({ message: 'INVOICE_DRAFT_INPUT_INVALID' })
  }
  const data = await editRpc(ctx, 'update_invoice_draft_atomic', {
    target_company_id: ctx.companyId.toLowerCase(), target_invoice_id: input.invoiceId.toLowerCase(),
    expected_revision: input.expectedRevision, expected_item_ids: input.expectedItemIds,
    header_input: input.header, item_inputs: input.items,
  })
  return draftEditResult(data, input.invoiceId)
}

export async function refreshInvoiceSupplierAtomic(ctx: InvoiceIssueContext, input: InvoiceDraftEditIdentity) {
  assertEditIdentity(ctx, input)
  assertEditItems(input.expectedItemIds)
  const data = await editRpc(ctx, 'refresh_invoice_supplier_atomic', {
    target_company_id: ctx.companyId.toLowerCase(), target_invoice_id: input.invoiceId.toLowerCase(),
    expected_revision: input.expectedRevision, expected_item_ids: input.expectedItemIds,
  })
  return draftEditResult(data, input.invoiceId)
}

export async function issueInvoiceRevisionAtomic(ctx: InvoiceIssueContext, input: Pick<InvoiceDraftEditIdentity, 'invoiceId' | 'expectedRevision'>): Promise<InvoiceIssueResult> {
  assertEditIdentity(ctx, input)
  const data = await editRpc(ctx, 'issue_invoice_revision_atomic', {
    target_company_id: ctx.companyId.toLowerCase(), target_invoice_id: input.invoiceId.toLowerCase(),
    expected_revision: input.expectedRevision,
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || data.invoice_id !== input.invoiceId.toLowerCase() || typeof data.issued !== 'boolean'
    || typeof data.invoice_number !== 'string' || !data.invoice_number.trim()
    || !['issued', 'sent', 'paid', 'overdue'].includes(data.status)
    || (data.issued && data.status !== 'issued')) throw invoiceDraftEditError(null)
  return { invoiceId: data.invoice_id, invoiceNumber: data.invoice_number, status: data.status,
    issued: data.issued, alreadyIssued: !data.issued }
}
