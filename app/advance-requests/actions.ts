'use server'

import { revalidatePath } from 'next/cache'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { AdvanceError, advanceError, payAdvance, readAdvanceLedger, requestAdvance, reviewAdvance, settleAdvance, type AdvanceContext, type AdvanceResult } from '@/lib/dal/worker-advances'
import { companyPayrollQuery, readActivePayrollMember, readPayrollRows } from '@/lib/dal/payroll-readers'
import type { AdvancePayment } from '@/lib/payroll/advances'

export type AdvanceActionResult = { ok: true; data: AdvanceResult } | { ok: false; error: string; uncertain: boolean }
async function context(expectedCompanyId: string, admin: boolean): Promise<AdvanceContext> {
  // Resolve all memberships first; never switch tenants to find an admin membership.
  const access = await requireWorkerAccess()
  if (!access.ok || access.value.companyId !== expectedCompanyId
    || (admin && !['company_admin', 'super_admin'].includes(access.value.role ?? ''))) {
    throw new AdvanceError('Oprávnění nebo aktivní firma se změnily. Obnovte stránku.')
  }
  return { companyId: access.value.companyId, profileId: access.value.profileId, supabase: await createSupabaseServerClient() }
}
async function run(expectedCompanyId: string, admin: boolean, fn: (ctx: AdvanceContext) => Promise<AdvanceResult>): Promise<AdvanceActionResult> {
  try {
    const ctx = await context(expectedCompanyId, admin)
    const data = await fn(ctx)
    for (const path of ['/', '/advance-requests', '/workers', '/mobile/my/advances']) revalidatePath(path)
    if (data.request?.profile_id || data.payment?.profile_id) revalidatePath(`/workers/${data.request?.profile_id ?? data.payment?.profile_id}`)
    return { ok: true, data }
  } catch (error) {
    const safe = advanceError(error)
    return { ok: false, error: safe.message, uncertain: safe.uncertain }
  }
}
export async function requestAdvanceAction(input: Parameters<typeof requestAdvance>[1] & { companyId: string }) {
  return run(input.companyId, false, ctx => requestAdvance(ctx, input))
}
export async function reviewAdvanceAction(input: Parameters<typeof reviewAdvance>[1] & { companyId: string }) {
  return run(input.companyId, true, ctx => reviewAdvance(ctx, input))
}
export async function payAdvanceAction(input: Parameters<typeof payAdvance>[1] & { companyId: string }) {
  return run(input.companyId, true, ctx => payAdvance(ctx, input))
}
export async function settleAdvanceAction(input: Parameters<typeof settleAdvance>[1] & { companyId: string }) {
  return run(input.companyId, true, ctx => settleAdvance(ctx, input))
}

export async function readWorkerAdvanceHistoryAction(profileId: string) {
  try {
    const access = await requireWorkerAccess()
    if (!access.ok) throw new AdvanceError('Přihlaste se do aktivní firmy.')
    const ctx = await context(access.value.companyId, true)
    const member = await readActivePayrollMember(ctx.supabase, ctx.companyId, profileId)
    if (member.error || !member.data) throw new AdvanceError('Pracovník nepatří do aktivní firmy.')
    const result = await readAdvanceLedger(ctx.supabase, ctx.companyId, { profileId })
    return { data: result.payments, error: null }
  } catch {
    return { data: [], error: { message: 'Historii záloh pracovníka nelze v aktivní firmě načíst.' } }
  }
}

type WorkerFinanceHistory = {
  profile: { id: string; full_name: string | null; email: string | null; default_hourly_rate: number | null }
  advances: AdvancePayment[]
  payrollItems: Array<{ id: string; profile_id: string; payroll_month: string | null; item_type: string | null; amount: number | string | null; note: string | null; created_at: string | null }>
}
export async function readWorkerFinanceHistoryAction(profileId: string): Promise<{
  data: WorkerFinanceHistory | null; error: { message: string } | null
}> {
  try {
    const access = await requireWorkerAccess()
    if (!access.ok) throw new AdvanceError('Přihlaste se do aktivní firmy.')
    const ctx = await context(access.value.companyId, true)
    const member = await readActivePayrollMember(ctx.supabase, ctx.companyId, profileId)
    if (member.error || !member.data) throw new AdvanceError('Pracovník nepatří do aktivní firmy.')
    const [profile, ledger, payrollItems] = await Promise.all([
      ctx.supabase.from('profiles').select('id, full_name, email, default_hourly_rate').eq('id', profileId).maybeSingle(),
      readAdvanceLedger(ctx.supabase, ctx.companyId, { profileId }),
      readPayrollRows(companyPayrollQuery(ctx.supabase, ctx.companyId, 'payroll_items', 'id, profile_id, payroll_month, item_type, amount, note, created_at')
        .eq('profile_id', profileId).order('payroll_month', { ascending: false }).order('created_at', { ascending: false }).order('id')),
    ])
    if (profile.error || !profile.data || payrollItems.error) throw new AdvanceError('Mzdové podklady nelze načíst.')
    return { data: { profile: profile.data, advances: ledger.payments, payrollItems: payrollItems.data as WorkerFinanceHistory['payrollItems'] }, error: null }
  } catch {
    return { data: null, error: { message: 'Finanční údaje pracovníka nelze v aktivní firmě načíst.' } }
  }
}
