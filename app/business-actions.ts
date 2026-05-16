'use server'

import { revalidatePath } from 'next/cache'

import {
  createCalculation,
  type CalculationItemInput,
  type SaveCalculationInput,
  updateCalculation,
} from '@/lib/dal/calculations'
import { DalAuthError, requireCompanyRoleDalContext, type DalContext } from '@/lib/dal/auth'
import {
  createJobCostItem,
  deleteJobCostItem,
  type CostType,
  type JobCostItemDto,
  updateJobAssignmentEconomics,
  updateJobPrice,
  updateWorkShift,
  type WorkShiftDto,
} from '@/lib/dal/jobs'
import {
  createJobFromQuote,
  createQuoteFromCalculation,
  markJobCompleted,
  markReadyForInvoice,
} from '@/lib/dal/flow'
import { updateQuote } from '@/lib/dal/quotes'
import { assertCustomerInCompany, TenantScopeError } from '@/lib/dal/companies'
import type { QuoteStatus } from '@/lib/quote-status'

export type ActionResult<T = void> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
    }

const quoteStatuses: QuoteStatus[] = [
  'draft',
  'ready',
  'sent',
  'viewed',
  'waiting_followup',
  'revision_requested',
  'accepted',
  'rejected',
  'expired',
]

const costTypes: CostType[] = [
  'material',
  'labor',
  'transport',
  'equipment',
  'accommodation',
  'consumption',
  'other',
]

type QuoteScopeRow = {
  id: string
  customer_id: string | null
  status: string | null
  source_calculation_id: string | null
  discount_amount: number | string | null
}

type QuoteCalculationItemRow = {
  sort_order: number | null
  name: string | null
  description: string | null
  quantity: number | string | null
  unit: string | null
  unit_price: number | string | null
  vat_rate: number | string | null
  total_price: number | string | null
  note: string | null
}

function actionError(error: unknown): ActionResult<never> {
  if (error instanceof DalAuthError || error instanceof TenantScopeError) {
    return { ok: false, error: error.message }
  }

  if (error instanceof Error && error.message.trim()) {
    return { ok: false, error: error.message }
  }

  return { ok: false, error: 'Akci se nepodarilo dokoncit.' }
}

function requiredString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} je povinne.`)
  }

  return value.trim()
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Neplatna textova hodnota.')
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberValue(value: unknown, fieldName: string) {
  const nextValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(nextValue)) {
    throw new Error(`${fieldName} musi byt cislo.`)
  }

  return nextValue
}

function nonNegativeNumber(value: unknown, fieldName: string) {
  const nextValue = numberValue(value, fieldName)

  if (nextValue < 0) {
    throw new Error(`${fieldName} nesmi byt zaporne.`)
  }

  return nextValue
}

function moneyValue(value: unknown) {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100) / 100
}

function optionalNonNegativeNumber(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return null
  return nonNegativeNumber(value, fieldName)
}

function isoString(value: unknown, fieldName: string) {
  const rawValue = requiredString(value, fieldName)
  const date = new Date(rawValue)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} musi byt platne datum.`)
  }

  return date.toISOString()
}

function parseCalculationItems(value: unknown): CalculationItemInput[] {
  if (!Array.isArray(value)) throw new Error('Polozky kalkulace musi byt seznam.')

  const items = value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Polozka kalkulace ma neplatny format.')
    }

    const row = item as Record<string, unknown>

    return {
      sortOrder: nonNegativeNumber(row.sortOrder, 'Poradi polozky'),
      itemType: optionalString(row.itemType),
      name: requiredString(row.name, 'Nazev polozky'),
      description: optionalString(row.description),
      quantity: nonNegativeNumber(row.quantity, 'Mnozstvi'),
      unit: optionalString(row.unit),
      unitCost: nonNegativeNumber(row.unitCost, 'Nakladova cena'),
      unitPrice: nonNegativeNumber(row.unitPrice, 'Jednotkova cena'),
      vatRate: nonNegativeNumber(row.vatRate, 'DPH'),
      totalCost: nonNegativeNumber(row.totalCost, 'Celkove naklady'),
      totalPrice: nonNegativeNumber(row.totalPrice, 'Celkova cena'),
      note: optionalString(row.note),
    }
  })

  if (items.length === 0) {
    throw new Error('Pridavejte alespon jednu polozku kalkulace.')
  }

  return items
}

function parseCalculationInput(input: unknown): SaveCalculationInput {
  if (!input || typeof input !== 'object') throw new Error('Neplatna data kalkulace.')
  const row = input as Record<string, unknown>

  return {
    customerId: optionalString(row.customerId),
    title: requiredString(row.title, 'Nazev kalkulace'),
    description: optionalString(row.description),
    status: optionalString(row.status) ?? 'draft',
    calculationDate: optionalString(row.calculationDate),
    internalNote: optionalString(row.internalNote),
    subtotalCost: nonNegativeNumber(row.subtotalCost, 'Naklady celkem'),
    subtotalPrice: nonNegativeNumber(row.subtotalPrice, 'Cena celkem'),
    marginAmount: numberValue(row.marginAmount, 'Marze'),
    totalPrice: nonNegativeNumber(row.totalPrice, 'Cena celkem'),
    currency: optionalString(row.currency) ?? 'CZK',
    items: parseCalculationItems(row.items),
  }
}

async function getScopedQuote(ctx: DalContext, quoteId: string, customerId?: string | null): Promise<QuoteScopeRow> {
  if (customerId) {
    await assertCustomerInCompany(ctx, customerId)
  }

  let query = ctx.supabase
    .from('quotes')
    .select('id, customer_id, status, source_calculation_id, discount_amount')
    .eq('id', quoteId)
    .eq('company_id', ctx.companyId)

  query = customerId ? query.eq('customer_id', customerId) : query.is('customer_id', null)

  const { data, error } = await query.maybeSingle()

  if (error || !data?.id) {
    throw new TenantScopeError('Nabidka nepatri do aktivni firmy.')
  }

  return data as QuoteScopeRow
}

function revalidateQuotePaths(customerId: string | null | undefined, quoteId: string) {
  if (customerId) {
    revalidatePath(`/customers/${customerId}/quotes`)
    revalidatePath(`/customers/${customerId}/quotes/${quoteId}`)
    revalidatePath(`/customers/${customerId}/quotes/${quoteId}/edit`)
  } else {
    revalidatePath(`/cenove-nabidky/${quoteId}`)
  }
  revalidatePath('/cenove-nabidky')
}

export async function updateQuoteAction(input: {
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
}): Promise<ActionResult> {
  try {
    const status = quoteStatuses.includes(input.status) ? input.status : 'draft'
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')

    await updateQuote(ctx, {
      quoteId: requiredString(input.quoteId, 'Nabidka'),
      customerId: requiredString(input.customerId, 'Zakaznik'),
      title: requiredString(input.title, 'Nazev nabidky'),
      shareToken: optionalString(input.shareToken),
      status,
      quoteDate: optionalString(input.quoteDate),
      validUntil: optionalString(input.validUntil),
      sentAt: optionalString(input.sentAt),
      acceptedAt: optionalString(input.acceptedAt),
      rejectedAt: optionalString(input.rejectedAt),
    })

    revalidateQuotePaths(input.customerId, input.quoteId)

    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function deleteQuoteAction(input: {
  quoteId: string
  customerId?: string | null
}): Promise<ActionResult> {
  try {
    const quoteId = requiredString(input.quoteId, 'Nabidka')
    const customerId = optionalString(input.customerId)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')

    await getScopedQuote(ctx, quoteId, customerId)

    const itemsResponse = await ctx.supabase.from('quote_items').delete().eq('quote_id', quoteId)
    if (itemsResponse.error) throw itemsResponse.error

    const { data, error } = await ctx.supabase
      .from('quotes')
      .delete()
      .eq('id', quoteId)
      .eq('company_id', ctx.companyId)
      .select('id')

    if (error) throw error
    if (!data || data.length === 0) throw new Error('Nabidku se nepodarilo smazat.')

    if (customerId) {
      revalidatePath(`/customers/${customerId}/quotes`)
      revalidatePath(`/customers/${customerId}`)
    } else {
      revalidatePath(`/cenove-nabidky/${quoteId}`)
    }
    revalidatePath('/cenove-nabidky')

    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function syncQuotePricingFromCalculationAction(input: {
  quoteId: string
  customerId?: string | null
  sourceCalculationId: string
}): Promise<ActionResult<{ subtotalPrice: number; totalPrice: number }>> {
  try {
    const quoteId = requiredString(input.quoteId, 'Nabidka')
    const customerId = optionalString(input.customerId)
    const sourceCalculationId = requiredString(input.sourceCalculationId, 'Zdrojova kalkulace')
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const quote = await getScopedQuote(ctx, quoteId, customerId)

    if (quote.source_calculation_id && quote.source_calculation_id !== sourceCalculationId) {
      throw new Error('Zdrojova kalkulace nepatri k teto nabidce.')
    }

    const { data: calculation, error: calculationError } = await ctx.supabase
      .from('calculations')
      .select('id, customer_id, subtotal_price, total_price')
      .eq('id', sourceCalculationId)
      .eq('company_id', ctx.companyId)
      .maybeSingle()

    if (calculationError || !calculation?.id) {
      throw new TenantScopeError('Kalkulace nepatri do aktivni firmy.')
    }

    if (customerId && calculation.customer_id && calculation.customer_id !== customerId) {
      throw new TenantScopeError('Kalkulace nepatri k zakaznikovi teto nabidky.')
    }
    if (!customerId && calculation.customer_id) {
      throw new TenantScopeError('Kalkulace patri k zakaznikovi, ale nabidka je bez zakaznika.')
    }

    const { data: items, error: itemsError } = await ctx.supabase
      .from('calculation_items')
      .select('sort_order, name, description, quantity, unit, unit_price, vat_rate, total_price, note')
      .eq('calculation_id', sourceCalculationId)
      .eq('item_type', 'customer')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (itemsError) throw itemsError

    const customerItems = ((items ?? []) as QuoteCalculationItemRow[]).filter((item) => item.name?.trim())
    if (customerItems.length === 0) {
      throw new Error('Zdrojova kalkulace nema zadne zakaznicke polozky pro aktualizaci nabidky.')
    }

    const deleteResponse = await ctx.supabase.from('quote_items').delete().eq('quote_id', quoteId)
    if (deleteResponse.error) throw deleteResponse.error

    const quoteItems = customerItems.map((item) => ({
      company_id: ctx.companyId,
      quote_id: quoteId,
      sort_order: item.sort_order ?? 0,
      name: item.name?.trim() || 'Polozka',
      description: item.description ?? null,
      quantity: Number(item.quantity ?? 0),
      unit: item.unit ?? null,
      unit_price: moneyValue(item.unit_price),
      vat_rate: Number(item.vat_rate ?? 0),
      total_price: moneyValue(item.total_price),
      note: item.note ?? null,
    }))

    const insertResponse = await ctx.supabase.from('quote_items').insert(quoteItems)
    if (insertResponse.error) throw insertResponse.error

    const subtotalPrice = moneyValue(calculation.subtotal_price ?? calculation.total_price)
    const totalPrice = Math.max(0, subtotalPrice - moneyValue(quote.discount_amount))
    let updateQuery = ctx.supabase
      .from('quotes')
      .update({
        subtotal_price: subtotalPrice,
        total_price: totalPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteId)
      .eq('company_id', ctx.companyId)

    updateQuery = customerId ? updateQuery.eq('customer_id', customerId) : updateQuery.is('customer_id', null)
    const updateResponse = await updateQuery

    if (updateResponse.error) throw updateResponse.error

    revalidateQuotePaths(customerId, quoteId)

    return { ok: true, data: { subtotalPrice, totalPrice } }
  } catch (error) {
    return actionError(error)
  }
}

export async function markQuoteSentAction(input: {
  quoteId: string
  customerId?: string | null
}): Promise<ActionResult<{ status: QuoteStatus }>> {
  try {
    const quoteId = requiredString(input.quoteId, 'Nabidka')
    const customerId = optionalString(input.customerId)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const quote = await getScopedQuote(ctx, quoteId, customerId)
    const currentStatus = quote.status === 'accepted' || quote.status === 'rejected' ? quote.status : 'sent'

    let updateQuery = ctx.supabase
      .from('quotes')
      .update({
        sent_at: new Date().toISOString(),
        status: currentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteId)
      .eq('company_id', ctx.companyId)

    updateQuery = customerId ? updateQuery.eq('customer_id', customerId) : updateQuery.is('customer_id', null)
    const { error } = await updateQuery

    if (error) throw error

    revalidateQuotePaths(customerId, quoteId)

    return { ok: true, data: { status: currentStatus as QuoteStatus } }
  } catch (error) {
    return actionError(error)
  }
}

export async function rejectQuoteAction(input: {
  quoteId: string
  customerId?: string | null
}): Promise<ActionResult> {
  try {
    const quoteId = requiredString(input.quoteId, 'Nabidka')
    const customerId = optionalString(input.customerId)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')

    await getScopedQuote(ctx, quoteId, customerId)

    let updateQuery = ctx.supabase
      .from('quotes')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteId)
      .eq('company_id', ctx.companyId)

    updateQuery = customerId ? updateQuery.eq('customer_id', customerId) : updateQuery.is('customer_id', null)
    const { error } = await updateQuery

    if (error) throw error

    revalidateQuotePaths(customerId, quoteId)

    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function createCalculationAction(input: unknown): Promise<ActionResult<{ calculationId: string }>> {
  try {
    const parsed = parseCalculationInput(input)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const calculationId = await createCalculation(ctx, parsed)

    if (parsed.customerId) {
      revalidatePath(`/customers/${parsed.customerId}/calculations`)
      revalidatePath(`/customers/${parsed.customerId}`)
    } else {
      revalidatePath('/kalkulace')
    }

    return { ok: true, data: { calculationId } }
  } catch (error) {
    return actionError(error)
  }
}

export async function createQuoteFromCalculationAction(input: {
  calculationId: string
}): Promise<ActionResult<{ quoteId: string; created: boolean }>> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const result = await createQuoteFromCalculation(
      ctx,
      requiredString(input.calculationId, 'Kalkulace'),
    )

    revalidatePath(`/customers`)
    revalidatePath('/cenove-nabidky')

    return { ok: true, data: result }
  } catch (error) {
    return actionError(error)
  }
}

export async function createJobFromQuoteAction(input: {
  quoteId: string
  title: string
  description: string | null
  address: string | null
  startAt: string
  endAt: string
  splitDays?: {
    label: string
    startAt: string
    endAt: string
  }[]
}): Promise<ActionResult<{ jobId: string; created: boolean }>> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const splitDays = Array.isArray(input.splitDays)
      ? input.splitDays.map((day) => ({
          label: requiredString(day.label, 'Den realizace'),
          startAt: isoString(day.startAt, 'Zacatek realizace dne'),
          endAt: isoString(day.endAt, 'Konec realizace dne'),
        }))
      : []

    const result = await createJobFromQuote(ctx, {
      quoteId: requiredString(input.quoteId, 'Nabidka'),
      title: requiredString(input.title, 'Nazev zakazky'),
      description: optionalString(input.description),
      address: optionalString(input.address),
      startAt: isoString(input.startAt, 'Zacatek realizace'),
      endAt: isoString(input.endAt, 'Konec realizace'),
      splitDays,
    })

    revalidatePath(`/jobs/${result.jobId}`)
    revalidatePath('/jobs')
    revalidatePath('/cenove-nabidky')

    return { ok: true, data: result }
  } catch (error) {
    return actionError(error)
  }
}

export async function markJobCompletedAction(input: {
  jobId: string
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakazka')
    await markJobCompleted(ctx, jobId)
    await markReadyForInvoice(ctx, jobId)
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath('/jobs')
    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function updateCalculationAction(
  calculationId: string,
  input: unknown,
): Promise<ActionResult<{ calculationId: string }>> {
  try {
    const parsed = parseCalculationInput(input)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const savedCalculationId = await updateCalculation(
      ctx,
      requiredString(calculationId, 'Kalkulace'),
      parsed,
    )

    if (parsed.customerId) {
      revalidatePath(`/customers/${parsed.customerId}/calculations/${savedCalculationId}`)
      revalidatePath(`/customers/${parsed.customerId}/calculations/${savedCalculationId}/edit`)
    } else {
      revalidatePath(`/kalkulace/${savedCalculationId}`)
      revalidatePath(`/kalkulace/${savedCalculationId}/edit`)
    }

    return { ok: true, data: { calculationId: savedCalculationId } }
  } catch (error) {
    return actionError(error)
  }
}

export async function updateJobPriceAction(input: {
  jobId: string
  price: number
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakazka')
    await updateJobPrice(ctx, jobId, nonNegativeNumber(input.price, 'Cena'))
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath('/')
    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function createJobCostItemAction(input: {
  jobId: string
  costType: CostType
  title: string
  quantity: number
  unit: string | null
  unitPrice: number
  totalPrice: number
  note?: string | null
}): Promise<ActionResult<{ item: JobCostItemDto }>> {
  try {
    const costType = costTypes.includes(input.costType) ? input.costType : 'other'
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakazka')
    const item = await createJobCostItem(ctx, {
      jobId,
      costType,
      title: requiredString(input.title, 'Nazev nakladu'),
      quantity: nonNegativeNumber(input.quantity, 'Mnozstvi'),
      unit: optionalString(input.unit),
      unitPrice: nonNegativeNumber(input.unitPrice, 'Jednotkova cena'),
      totalPrice: nonNegativeNumber(input.totalPrice, 'Celkova cena'),
      note: optionalString(input.note),
    })

    revalidatePath(`/jobs/${jobId}`)
    revalidatePath('/')

    return { ok: true, data: { item } }
  } catch (error) {
    return actionError(error)
  }
}

export async function deleteJobCostItemAction(input: {
  id: string
  jobId: string
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakazka')
    await deleteJobCostItem(ctx, requiredString(input.id, 'Naklad'))
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath('/')
    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function updateJobAssignmentEconomicsAction(input: {
  jobId: string
  profileId: string
  laborHours: number
  hourlyRate: number
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakazka')
    await updateJobAssignmentEconomics(ctx, {
      jobId,
      profileId: requiredString(input.profileId, 'Pracovnik'),
      laborHours: nonNegativeNumber(input.laborHours, 'Hodiny'),
      hourlyRate: nonNegativeNumber(input.hourlyRate, 'Sazba'),
    })

    revalidatePath(`/jobs/${jobId}`)

    return { ok: true, data: undefined }
  } catch (error) {
    return actionError(error)
  }
}

export async function updateWorkShiftAction(input: {
  shiftId: string
  jobId?: string | null
  shiftDate: string | null
  startedAt: string | null
  endedAt: string | null
  hoursOverride: number | null
  jobHoursOverride?: number | null
  note: string | null
  supportsJobAssignment: boolean
}): Promise<ActionResult<{ shift: WorkShiftDto }>> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const shift = await updateWorkShift(ctx, {
      shiftId: requiredString(input.shiftId, 'Smena'),
      jobId: optionalString(input.jobId),
      shiftDate: optionalString(input.shiftDate),
      startedAt: optionalString(input.startedAt),
      endedAt: optionalString(input.endedAt),
      hoursOverride: optionalNonNegativeNumber(input.hoursOverride, 'Hodiny'),
      jobHoursOverride: optionalNonNegativeNumber(input.jobHoursOverride, 'Hodiny zakazky'),
      note: optionalString(input.note),
      supportsJobAssignment: Boolean(input.supportsJobAssignment),
    })

    if (shift.job_id) {
      revalidatePath(`/jobs/${shift.job_id}`)
    }

    return { ok: true, data: { shift } }
  } catch (error) {
    return actionError(error)
  }
}
