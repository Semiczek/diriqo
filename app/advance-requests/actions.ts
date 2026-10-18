'use server'

import { revalidatePath } from 'next/cache'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { AdvanceError, advanceError, payAdvance, readAdvanceLedger, requestAdvance, reviewAdvance, settleAdvance, type AdvanceContext, type AdvanceResult } from '@/lib/dal/worker-advances'

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
    const result = await readAdvanceLedger(ctx.supabase, ctx.companyId, { profileId })
    return { data: result.payments, error: null }
  } catch {
    return { data: [], error: { message: 'Historii záloh pracovníka nelze v aktivní firmě načíst.' } }
  }
}
