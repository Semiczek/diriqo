'use server'

import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { listJobEconomicsSummaries } from '@/lib/dal/economics'
import { laborHistoryId, parseLaborJobIds } from '@/lib/labor-history'
import type { JobEconomicsSummary } from '@/lib/economics'

export type JobEconomicsReadResult =
  | { ok: true; companyId: string; profileId: string; summaries: JobEconomicsSummary[] }
  | { ok: false; error: string }

export async function readJobEconomicsAction(raw: unknown): Promise<JobEconomicsReadResult> {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid request')
    const input = raw as Record<string, unknown>
    const companyId = laborHistoryId(input.companyId)
    const profileId = laborHistoryId(input.profileId)
    const jobIds = parseLaborJobIds(input.jobIds)
    const ctx = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    if (ctx.companyId !== companyId || ctx.profileId !== profileId) throw new Error('Scope changed')
    const summaries = await listJobEconomicsSummaries(ctx, jobIds)
    return { ok: true, companyId, profileId, summaries }
  } catch {
    return { ok: false, error: 'Ekonomiku nelze načíst. Ověřte aktivní firmu a obnovte stránku.' }
  }
}
