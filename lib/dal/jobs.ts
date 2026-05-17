import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import { assertProfileInCompany, TenantScopeError } from '@/lib/dal/companies'

export type CostType =
  | 'material'
  | 'labor'
  | 'transport'
  | 'equipment'
  | 'accommodation'
  | 'consumption'
  | 'other'

export type JobCostItemDto = {
  id: string
  job_id: string
  cost_type: CostType
  title: string | null
  quantity: number
  unit: string | null
  unit_price: number
  total_price: number
  note?: string | null
}

export type WorkShiftDto = {
  id: string
  job_id?: string | null
  job_hours_override?: number | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | null
  note: string | null
}

async function assertJobInCompany(ctx: DalContext, jobId: string) {
  const { data, error } = await ctx.supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (error || !data?.id) {
    throw new TenantScopeError('Zakázka nepatří do aktivní firmy.')
  }
}

async function logJobEconomicsAudit(
  ctx: DalContext,
  input: {
    jobId: string
    eventType: string
    beforeValue?: Record<string, unknown>
    afterValue?: Record<string, unknown>
  },
) {
  const { error } = await ctx.supabase.from('job_economics_audit_events').insert({
    company_id: ctx.companyId,
    job_id: input.jobId,
    actor_profile_id: ctx.profileId,
    event_type: input.eventType,
    before_value: input.beforeValue ?? {},
    after_value: input.afterValue ?? {},
  })

  if (error && error.code !== '42P01') {
    console.warn('Job economics audit event was not recorded.', error.message)
  }
}

export async function updateJobPrice(ctx: DalContext, jobId: string, price: number) {
  await assertJobInCompany(ctx, jobId)

  const { data: beforeJob, error: beforeError } = await ctx.supabase
    .from('jobs')
    .select('price')
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (beforeError) throw beforeError

  const { error } = await ctx.supabase
    .from('jobs')
    .update({ price })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)

  if (error) throw error

  await logJobEconomicsAudit(ctx, {
    jobId,
    eventType: 'job_price_updated',
    beforeValue: { price: beforeJob?.price ?? null },
    afterValue: { price },
  })
}

export async function createJobCostItem(
  ctx: DalContext,
  input: {
    jobId: string
    costType: CostType
    title: string
    quantity: number
    unit: string | null
    unitPrice: number
    totalPrice: number
    note: string | null
  },
): Promise<JobCostItemDto> {
  await assertJobInCompany(ctx, input.jobId)

  const { data, error } = await ctx.supabase
    .from('job_cost_items')
    .insert({
      company_id: ctx.companyId,
      job_id: input.jobId,
      cost_type: input.costType,
      name: input.title,
      amount: input.totalPrice,
      title: input.title,
      quantity: input.quantity,
      unit: input.unit,
      unit_price: input.unitPrice,
      total_price: input.totalPrice,
      note: input.note,
    })
    .select('id, job_id, cost_type, title, quantity, unit, unit_price, total_price, note')
    .single()

  if (error || !data) throw error ?? new Error('Náklad se nepodařilo uložit.')

  await logJobEconomicsAudit(ctx, {
    jobId: input.jobId,
    eventType: 'job_cost_item_created',
    afterValue: { item: data },
  })

  return data as JobCostItemDto
}

export async function deleteJobCostItem(ctx: DalContext, id: string) {
  const { data: beforeItem, error: beforeError } = await ctx.supabase
    .from('job_cost_items')
    .select('id, job_id, cost_type, title, quantity, unit, unit_price, total_price, note')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (beforeError) throw beforeError

  const { error } = await ctx.supabase
    .from('job_cost_items')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)

  if (error) throw error

  if (beforeItem?.job_id) {
    await logJobEconomicsAudit(ctx, {
      jobId: beforeItem.job_id,
      eventType: 'job_cost_item_deleted',
      beforeValue: { item: beforeItem },
    })
  }
}

export async function updateJobAssignmentEconomics(
  ctx: DalContext,
  input: {
    jobId: string
    profileId: string
    laborHours: number
    hourlyRate: number
  },
) {
  await assertJobInCompany(ctx, input.jobId)
  await assertProfileInCompany(ctx, input.profileId)

  const { error } = await ctx.supabase
    .from('job_assignments')
    .update({
      labor_hours: input.laborHours,
      hourly_rate: input.hourlyRate,
    })
    .eq('job_id', input.jobId)
    .eq('profile_id', input.profileId)

  if (error) throw error
}

export async function updateWorkShift(
  ctx: DalContext,
  input: {
    shiftId: string
    jobId?: string | null
    shiftDate: string | null
    startedAt: string | null
    endedAt: string | null
    hoursOverride: number | null
    jobHoursOverride?: number | null
    note: string | null
    supportsJobAssignment: boolean
  },
): Promise<WorkShiftDto> {
  if (input.jobId) {
    await assertJobInCompany(ctx, input.jobId)
  }

  const payload: Record<string, string | number | null> = {
    shift_date: input.shiftDate,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    hours_override: input.hoursOverride,
    note: input.note,
  }

  if (input.supportsJobAssignment) {
    payload.job_id = input.jobId ?? null
    payload.job_hours_override = input.jobHoursOverride ?? null
  }

  const selectColumns = input.supportsJobAssignment
    ? 'id, job_id, job_hours_override, shift_date, started_at, ended_at, hours_override, note'
    : 'id, shift_date, started_at, ended_at, hours_override, note'

  const { data, error } = await ctx.supabase
    .from('work_shifts')
    .update(payload)
    .eq('id', input.shiftId)
    .eq('company_id', ctx.companyId)
    .select(selectColumns)
    .single()

  if (error || !data) throw error ?? new Error('Směnu se nepodařilo uložit.')

  return data as unknown as WorkShiftDto
}
