import 'server-only'

import type { DalContext } from './auth'
import {
  coreCalculationId, coreCalculationSaveError, parseCoreCalculationCreate, parseCoreCalculationUpdate, parseCoreCalculationSaveReceipt,
  type CoreCalculationCreateInput, type CoreCalculationUpdateInput, type CoreCalculationSaveReceipt,
} from '@/lib/core-calculation-save'

type SaveContext = Pick<DalContext, 'companyId' | 'profileId' | 'role' | 'supabase'>

function rpcInput(input: CoreCalculationCreateInput) {
  return {
    customer_id: input.customerId, title: input.title, description: input.description, status: input.status,
    calculation_date: input.calculationDate, internal_note: input.internalNote, currency: input.currency,
    items: input.items.map(item => ({
      item_type: item.itemType, name: item.name, description: item.description, quantity: item.quantity, unit: item.unit,
      unit_cost: item.unitCost, unit_price: item.unitPrice, vat_rate: item.vatRate, note: item.note,
    })),
  }
}
async function save(ctx: SaveContext, input: CoreCalculationCreateInput, update?: CoreCalculationUpdateInput): Promise<CoreCalculationSaveReceipt> {
  if (input.companyId !== coreCalculationId(ctx.companyId) || input.profileId !== coreCalculationId(ctx.profileId)
    || !['company_admin', 'super_admin'].includes(ctx.role ?? '')) {
    throw coreCalculationSaveError({ message: 'CALCULATION_FORBIDDEN' })
  }
  try {
    const auth = await ctx.supabase.auth.getUser()
    if (auth.error || !auth.data.user) throw coreCalculationSaveError({ message: 'CALCULATION_FORBIDDEN' })
    const args = {
      p_company_id: input.companyId, p_operation_id: input.operationId, p_input: rpcInput(input),
      ...(update ? { p_calculation_id: update.calculationId, p_expected_revision: update.expectedRevision } : {}),
    }
    const { data, error } = await ctx.supabase.rpc(update ? 'update_core_calculation_atomic' : 'create_core_calculation_atomic', args)
    if (error) throw coreCalculationSaveError(error)
    // A malformed response can arrive after COMMIT. Never invent success or a new operation ID.
    return parseCoreCalculationSaveReceipt(data, update ?? input, update ? 'update' : 'create')
  } catch (error) { throw coreCalculationSaveError(error) }
}
export async function createCoreCalculation(ctx: SaveContext, input: CoreCalculationCreateInput): Promise<CoreCalculationSaveReceipt> {
  return save(ctx, parseCoreCalculationCreate(input))
}
export async function updateCoreCalculation(ctx: SaveContext, input: CoreCalculationUpdateInput): Promise<CoreCalculationSaveReceipt> {
  const parsed = parseCoreCalculationUpdate(input)
  return save(ctx, parsed, parsed)
}
