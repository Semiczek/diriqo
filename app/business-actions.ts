'use server'

import { revalidatePath } from 'next/cache'

import { createCalculation, updateCalculation } from '@/lib/dal/calculations'
import {
  parseCoreCalculationCreate, parseCoreCalculationUpdate, coreCalculationSaveError,
  type CoreCalculationSaveResult,
} from '@/lib/core-calculation-save'
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
import {
  updateQuote, deleteCoreQuoteDraft, archiveCoreQuote, syncCoreQuoteDraft,
  openCoreQuoteRevision, publishCoreQuoteVersion, recordCoreQuoteDecision, revokeCoreQuotePublication,
} from '@/lib/dal/quotes'
import {
  coreQuoteError, parseCoreQuoteCreate, parseCoreQuoteDraft, parseCoreQuoteDelete, parseCoreQuoteArchive,
  parseCoreQuoteSync, parseCoreQuoteOpenRevision, parseCoreQuotePublish, parseCoreQuoteDecision, parseCoreQuoteRevoke,
  type CoreQuoteResult, type CoreQuoteReceipt, type CoreQuotePublicationReceipt,
} from '@/lib/core-quote-lifecycle'
import { TenantScopeError } from '@/lib/dal/companies'

import type { CoreQuoteConversionInput, CoreQuoteConversionResult } from '@/lib/core-quote-conversion'
import { coreQuoteConversionError } from '@/lib/dal/core-quote-conversion'

export type ActionResult<T = void> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
    }

const costTypes: CostType[] = [
  'material',
  'labor',
  'transport',
  'equipment',
  'accommodation',
  'consumption',
  'other',
]

function actionError(error: unknown): ActionResult<never> {
  if (error instanceof DalAuthError || error instanceof TenantScopeError) {
    return { ok: false, error: error.message }
  }

  if (error instanceof Error && error.message.trim()) {
    return { ok: false, error: error.message }
  }

  return { ok: false, error: 'Akci se nepodařilo dokončit.' }
}

function requiredString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} je povinné.`)
  }

  return value.trim()
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Neplatná textová hodnota.')
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberValue(value: unknown, fieldName: string) {
  const nextValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(nextValue)) {
    throw new Error(`${fieldName} musí být číslo.`)
  }

  return nextValue
}

function nonNegativeNumber(value: unknown, fieldName: string) {
  const nextValue = numberValue(value, fieldName)

  if (nextValue < 0) {
    throw new Error(`${fieldName} nesmí být záporné.`)
  }

  return nextValue
}

function optionalNonNegativeNumber(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return null
  return nonNegativeNumber(value, fieldName)
}

function revalidateQuotePaths(quoteId: string) {
  revalidatePath('/customers', 'layout')
  revalidatePath('/cenove-nabidky')
  revalidatePath('/cenove-nabidky/' + quoteId)
}
function quoteActionError(error: unknown): CoreQuoteResult<never> {
  const safe = coreQuoteError(error instanceof DalAuthError || error instanceof TenantScopeError ? { message: 'CORE_QUOTE_FORBIDDEN' } : error)
  return { ok: false, error: safe.message, code: safe.code, uncertain: safe.uncertain }
}
async function quoteAction<T extends CoreQuoteReceipt>(operation: (ctx: DalContext) => Promise<T>): Promise<CoreQuoteResult<T>> {
  try {
    const ctx = await requireCompanyRoleDalContext('manager', 'company_admin', 'super_admin')
    const receipt = await operation(ctx)
    revalidateQuotePaths(receipt.quoteId)
    return { ok: true, data: receipt }
  } catch (error) {
    // Cache refresh can fail after COMMIT; preserve the operation for an exact retry.
    return quoteActionError(error)
  }
}
export async function updateQuoteAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => updateQuote(ctx, parseCoreQuoteDraft(input)))
}
export async function deleteQuoteAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => deleteCoreQuoteDraft(ctx, parseCoreQuoteDelete(input)))
}
export async function revokeQuotePublicationAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => revokeCoreQuotePublication(ctx, parseCoreQuoteRevoke(input)))
}
export async function archiveQuoteAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => archiveCoreQuote(ctx, parseCoreQuoteArchive(input)))
}
export async function syncQuotePricingFromCalculationAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => syncCoreQuoteDraft(ctx, parseCoreQuoteSync(input)))
}
export async function openQuoteRevisionAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => openCoreQuoteRevision(ctx, parseCoreQuoteOpenRevision(input)))
}
export async function publishQuoteAction(input: unknown): Promise<CoreQuoteResult<CoreQuotePublicationReceipt>> {
  return quoteAction(ctx => publishCoreQuoteVersion(ctx, parseCoreQuotePublish(input)))
}
export async function recordQuoteDecisionAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => recordCoreQuoteDecision(ctx, parseCoreQuoteDecision(input)))
}

function calculationActionError(error: unknown): CoreCalculationSaveResult {
  const safe = coreCalculationSaveError(error instanceof DalAuthError || error instanceof TenantScopeError
    ? { message: 'CALCULATION_FORBIDDEN' } : error)
  return { ok: false, error: safe.message, code: safe.code, uncertain: safe.uncertain }
}

export async function createCalculationAction(input: unknown): Promise<CoreCalculationSaveResult> {
  try {
    const parsed = parseCoreCalculationCreate(input)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const receipt = await createCalculation(ctx, parsed)
    revalidatePath('/kalkulace')
    if (parsed.customerId) {
      revalidatePath(`/customers/${parsed.customerId}/calculations`)
      revalidatePath(`/customers/${parsed.customerId}`)
    }
    return { ok: true, data: receipt }
  } catch (error) {
    // A failed cache refresh can follow COMMIT: the same request must remain retryable.
    return calculationActionError(error)
  }
}

export async function createQuoteFromCalculationAction(input: unknown): Promise<CoreQuoteResult> {
  return quoteAction(ctx => createQuoteFromCalculation(ctx, parseCoreQuoteCreate(input)))
}

export async function createJobFromQuoteAction(input: CoreQuoteConversionInput): Promise<CoreQuoteConversionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const result = await createJobFromQuote(ctx, input)
    revalidatePath('/jobs/' + result.jobId)
    revalidatePath('/jobs')
    revalidatePath('/cenove-nabidky')
    revalidatePath('/customers')
    return { ok: true, data: result }
  } catch (error) {
    const mapped = error instanceof DalAuthError || error instanceof TenantScopeError
      ? coreQuoteConversionError({ message: 'CORE_QUOTE_FORBIDDEN' })
      : coreQuoteConversionError(error)
    return { ok: false, error: mapped.message, code: mapped.code, uncertain: mapped.uncertain }
  }
}

export async function markJobCompletedAction(input: {
  jobId: string
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakázka')
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
): Promise<CoreCalculationSaveResult> {
  try {
    const parsed = parseCoreCalculationUpdate(input)
    if (typeof calculationId !== 'string' || calculationId.trim().toLowerCase() !== parsed.calculationId) {
      throw coreCalculationSaveError({ message: 'CALCULATION_INVALID_INPUT' })
    }
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const receipt = await updateCalculation(ctx, parsed)
    revalidatePath('/kalkulace')
    revalidatePath(`/kalkulace/${receipt.calculationId}`)
    revalidatePath(`/kalkulace/${receipt.calculationId}/edit`)
    if (parsed.customerId) {
      revalidatePath(`/customers/${parsed.customerId}`)
      revalidatePath(`/customers/${parsed.customerId}/calculations`)
      revalidatePath(`/customers/${parsed.customerId}/calculations/${receipt.calculationId}`)
      revalidatePath(`/customers/${parsed.customerId}/calculations/${receipt.calculationId}/edit`)
    }
    return { ok: true, data: receipt }
  } catch (error) {
    return calculationActionError(error)
  }
}

export async function updateJobPriceAction(input: {
  jobId: string
  price: number
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const jobId = requiredString(input.jobId, 'Zakázka')
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
    const jobId = requiredString(input.jobId, 'Zakázka')
    const item = await createJobCostItem(ctx, {
      jobId,
      costType,
      title: requiredString(input.title, 'Název nákladu'),
      quantity: nonNegativeNumber(input.quantity, 'Množství'),
      unit: optionalString(input.unit),
      unitPrice: nonNegativeNumber(input.unitPrice, 'Jednotková cena'),
      totalPrice: nonNegativeNumber(input.totalPrice, 'Celková cena'),
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
    const jobId = requiredString(input.jobId, 'Zakázka')
    await deleteJobCostItem(ctx, requiredString(input.id, 'Náklad'))
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
    const jobId = requiredString(input.jobId, 'Zakázka')
    await updateJobAssignmentEconomics(ctx, {
      jobId,
      profileId: requiredString(input.profileId, 'Pracovník'),
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
      shiftId: requiredString(input.shiftId, 'Směna'),
      jobId: optionalString(input.jobId),
      shiftDate: optionalString(input.shiftDate),
      startedAt: optionalString(input.startedAt),
      endedAt: optionalString(input.endedAt),
      hoursOverride: optionalNonNegativeNumber(input.hoursOverride, 'Hodiny'),
      jobHoursOverride: optionalNonNegativeNumber(input.jobHoursOverride, 'Hodiny zakázky'),
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
