'use server'

import { revalidatePath } from 'next/cache'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { getLaborCostPreview, reviewLaborSubmission, saveLaborSubmissionDraft, submitLaborSubmission } from '@/lib/dal/labor-history'
import { LaborHistoryError, laborHistoryId, type LaborSubmissionDto, type LaborCostPreviewDto } from '@/lib/labor-history'
import { parseLaborCommand } from './workflow'

export type LaborActionResult<T> = { ok: true; data: T } | { ok: false; code: string; uncertain: boolean }
export async function runLaborCommandAction(raw: unknown): Promise<LaborActionResult<LaborSubmissionDto>> {
  let started = false
  try {
    const command = parseLaborCommand(raw)
    const ctx = await requireCompanyRoleDalContext('worker', 'manager', 'company_admin', 'super_admin')
    started = true
    const data = command.kind === 'draft' ? await saveLaborSubmissionDraft(ctx, command.input)
      : command.kind === 'submit' ? await submitLaborSubmission(ctx, command.input) : await reviewLaborSubmission(ctx, command.input)
    try {
      revalidatePath('/labor')
      revalidatePath(`/jobs/${data.jobId}`)
      revalidatePath('/jobs')
      revalidatePath('/costs')
      revalidatePath('/')
    } catch { /* A confirmed receipt remains authoritative if refresh fails. */ }
    return { ok: true, data }
  } catch (error) {
    return error instanceof LaborHistoryError ? { ok: false, code: error.code, uncertain: error.uncertain }
      : { ok: false, code: started ? 'unknown' : 'forbidden', uncertain: started }
  }
}
export async function previewLaborAction(raw: { companyId: string; actorProfileId: string; submissionId: string; versionId: string }): Promise<LaborActionResult<LaborCostPreviewDto>> {
  try {
    const companyId = laborHistoryId(raw?.companyId), actorId = laborHistoryId(raw?.actorProfileId)
    const submissionId = laborHistoryId(raw?.submissionId), versionId = laborHistoryId(raw?.versionId)
    const ctx = await requireCompanyRoleDalContext('manager', 'company_admin', 'super_admin')
    if (companyId !== ctx.companyId || actorId !== ctx.profileId) return { ok: false, code: 'forbidden', uncertain: false }
    return { ok: true, data: await getLaborCostPreview(ctx, submissionId, versionId) }
  } catch (error) { return { ok: false, code: error instanceof LaborHistoryError ? error.code : 'forbidden', uncertain: false } }
}
