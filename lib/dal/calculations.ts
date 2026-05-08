import 'server-only'

import { assertCustomerInCompany, TenantScopeError } from '@/lib/dal/companies'
import type { DalContext } from '@/lib/dal/auth'

export type CalculationItemInput = {
  sortOrder: number
  itemType: string | null
  name: string
  description: string | null
  quantity: number
  unit: string | null
  unitCost: number
  unitPrice: number
  vatRate: number
  totalCost: number
  totalPrice: number
  note: string | null
}

export type SaveCalculationInput = {
  customerId: string | null
  title: string
  description: string | null
  status: string
  calculationDate: string | null
  internalNote: string | null
  subtotalCost: number
  subtotalPrice: number
  marginAmount: number
  totalPrice: number
  currency: string
  items: CalculationItemInput[]
}

export async function createCalculation(
  ctx: DalContext,
  input: SaveCalculationInput,
): Promise<string> {
  if (input.customerId) {
    await assertCustomerInCompany(ctx, input.customerId)
  }

  const { data, error } = await ctx.supabase
    .from('calculations')
    .insert({
      company_id: ctx.companyId,
      customer_id: input.customerId,
      title: input.title,
      description: input.description,
      status: input.status,
      calculation_date: input.calculationDate,
      internal_note: input.internalNote,
      subtotal_cost: input.subtotalCost,
      subtotal_price: input.subtotalPrice,
      margin_amount: input.marginAmount,
      total_price: input.totalPrice,
      currency: input.currency,
      created_by: ctx.profileId,
    })
    .select('id')
    .single()

  if (error || !data?.id) throw error ?? new Error('Kalkulaci se nepodarilo ulozit.')

  const rows = input.items.map((item) => ({
    calculation_id: data.id,
    sort_order: item.sortOrder,
    item_type: item.itemType,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_cost: item.unitCost,
    unit_price: item.unitPrice,
    vat_rate: item.vatRate,
    total_cost: item.totalCost,
    total_price: item.totalPrice,
    note: item.note,
  }))

  const { error: itemsError } = await ctx.supabase.from('calculation_items').insert(rows)

  if (itemsError) throw itemsError

  return data.id
}

export async function updateCalculation(
  ctx: DalContext,
  calculationId: string,
  input: SaveCalculationInput,
): Promise<string> {
  if (input.customerId) {
    await assertCustomerInCompany(ctx, input.customerId)
  }

  const { data: currentCalculation, error: currentError } = await ctx.supabase
    .from('calculations')
    .select(
      'id, title, description, status, calculation_date, internal_note, subtotal_cost, subtotal_price, margin_amount, total_price, currency, customer_id',
    )
    .eq('id', calculationId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (currentError || !currentCalculation?.id) {
    throw new TenantScopeError('Kalkulace nepatri do aktivni firmy.')
  }

  const { data: currentItems, error: currentItemsError } = await ctx.supabase
    .from('calculation_items')
    .select('sort_order, item_type, name, description, quantity, unit, unit_cost, unit_price, vat_rate, total_cost, total_price, note')
    .eq('calculation_id', calculationId)

  if (currentItemsError) throw currentItemsError

  const { data: latestVersion, error: versionLookupError } = await ctx.supabase
    .from('calculation_versions')
    .select('version_number')
    .eq('calculation_id', calculationId)
    .eq('company_id', ctx.companyId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (versionLookupError) throw versionLookupError

  const nextVersionNumber = Number(latestVersion?.version_number ?? 0) + 1

  const { data: version, error: versionError } = await ctx.supabase
    .from('calculation_versions')
    .insert({
      calculation_id: calculationId,
      company_id: ctx.companyId,
      version_number: nextVersionNumber,
      title: currentCalculation.title,
      description: currentCalculation.description,
      status: currentCalculation.status,
      calculation_date: currentCalculation.calculation_date,
      customer_id: currentCalculation.customer_id,
      internal_note: currentCalculation.internal_note,
      subtotal_cost: currentCalculation.subtotal_cost,
      subtotal_price: currentCalculation.subtotal_price,
      margin_amount: currentCalculation.margin_amount,
      total_price: currentCalculation.total_price,
      currency: currentCalculation.currency,
      saved_by: ctx.profileId,
    })
    .select('id')
    .single()

  if (versionError || !version?.id) {
    throw versionError ?? new Error('Verzi kalkulace se nepodarilo ulozit.')
  }

  const versionItems = (currentItems ?? []).map((item) => ({
    calculation_version_id: version.id,
    sort_order: item.sort_order,
    item_type: item.item_type,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_cost: item.unit_cost,
    unit_price: item.unit_price,
    vat_rate: item.vat_rate,
    total_cost: item.total_cost,
    total_price: item.total_price,
    note: item.note,
  }))

  if (versionItems.length > 0) {
    const { error: versionItemsError } = await ctx.supabase
      .from('calculation_version_items')
      .insert(versionItems)

    if (versionItemsError) throw versionItemsError
  }

  const { error: updateError } = await ctx.supabase
    .from('calculations')
    .update({
      customer_id: input.customerId,
      title: input.title,
      description: input.description,
      status: input.status,
      calculation_date: input.calculationDate,
      internal_note: input.internalNote,
      subtotal_cost: input.subtotalCost,
      subtotal_price: input.subtotalPrice,
      margin_amount: input.marginAmount,
      total_price: input.totalPrice,
      currency: input.currency,
    })
    .eq('id', calculationId)
    .eq('company_id', ctx.companyId)

  if (updateError) throw updateError

  const { error: deleteItemsError } = await ctx.supabase
    .from('calculation_items')
    .delete()
    .eq('calculation_id', calculationId)

  if (deleteItemsError) throw deleteItemsError

  const nextItems = input.items.map((item) => ({
    calculation_id: calculationId,
    sort_order: item.sortOrder,
    item_type: item.itemType,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_cost: item.unitCost,
    unit_price: item.unitPrice,
    vat_rate: item.vatRate,
    total_cost: item.totalCost,
    total_price: item.totalPrice,
    note: item.note,
  }))

  const { error: insertItemsError } = await ctx.supabase
    .from('calculation_items')
    .insert(nextItems)

  if (insertItemsError) throw insertItemsError

  return calculationId
}
