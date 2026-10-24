import 'server-only'

import type { DalContext } from './auth'
import {
  parseLaborDraftInput, parseLaborSubmitInput, parseLaborReviewInput, parseLaborSubmissionDto, parseLaborSubmissionListDto,
  parseLaborMutationReceipt, parseLaborCostPreviewDto, parseLaborJobIds, parseJobLaborCostTotalsDto, type JobLaborCostTotalsDto,
  parseLaborSourceOptionsDto, type LaborSourceOptionsDto,
  type LaborDraftInput, type LaborSubmitInput, type LaborReviewInput, type LaborSubmissionDto, type LaborSubmissionListDto, type LaborCostPreviewDto,
  LaborHistoryError, laborHistoryError, laborHistoryId, parseLaborRateListDto,
  parseLaborRateMutationReceipt, parseLaborRateScheduleInput,
  type LaborRateListDto, type LaborRateMutationReceipt, type LaborRateScheduleInput, type LaborWriteScope,
} from '@/lib/labor-history'

export type LaborHistoryContext = Pick<DalContext, 'supabase' | 'companyId' | 'profileId' | 'role'>
const financialRoles = ['company_admin', 'super_admin']
function forbidden(): never { throw laborHistoryError({ message: 'LABOR_FORBIDDEN' }) }
function guard(ctx: LaborHistoryContext, input?: LaborWriteScope, financial = false) {
  const companyId = laborHistoryId(ctx.companyId), actorProfileId = laborHistoryId(ctx.profileId)
  if (!['worker', 'manager', ...financialRoles].includes(ctx.role ?? '') || (financial && !financialRoles.includes(ctx.role ?? ''))) forbidden()
  if (input && (input.companyId !== companyId || input.actorProfileId !== actorProfileId)) forbidden()
  return { companyId, actorProfileId }
}
async function rpc(ctx: LaborHistoryContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const auth = await ctx.supabase.auth.getUser()
    if (auth.error || !auth.data.user) forbidden()
    const { data, error } = await ctx.supabase.rpc(name, args)
    if (error) throw laborHistoryError(error)
    return data
  } catch (error) {
    if (error instanceof LaborHistoryError) throw error
    throw laborHistoryError(error)
  }
}
export async function listLaborRates(ctx: LaborHistoryContext, profileId: string): Promise<LaborRateListDto> {
  const expected = { ...guard(ctx, undefined, true), profileId: laborHistoryId(profileId) }
  const data = await rpc(ctx, 'list_company_worker_rates', { target_company_id: expected.companyId, target_profile_id: expected.profileId })
  return parseLaborRateListDto(data, expected)
}
export async function scheduleLaborRate(ctx: LaborHistoryContext, value: LaborRateScheduleInput): Promise<LaborRateMutationReceipt> {
  const input = parseLaborRateScheduleInput(value)
  guard(ctx, input, true)
  const data = await rpc(ctx, 'set_company_worker_rate', {
    target_company_id: input.companyId,
    payload: { actor_profile_id: input.actorProfileId, profile_id: input.profileId,
      expected_schedule_revision: Number(input.expectedRevision), effective_from: input.effectiveFrom,
      amount: input.hourlyRate, currency: input.currency, unit: input.unit, worker_type: input.workerType,
      billing_type: input.billingType, reason: input.reason, operation_id: input.operationId },
  })
  return parseLaborRateMutationReceipt(data, input)
}


export async function getLaborSubmission(ctx: LaborHistoryContext, submissionId: string): Promise<LaborSubmissionDto> {
  const expected = { ...guard(ctx), submissionId: laborHistoryId(submissionId),
    ...(ctx.role === 'worker' ? { profileId: laborHistoryId(ctx.profileId) } : {}) }
  return parseLaborSubmissionDto(await rpc(ctx, 'get_labor_submission', {
    target_company_id: expected.companyId, target_submission_id: expected.submissionId,
  }), expected, financialRoles.includes(ctx.role ?? ''))
}
export async function listLaborSubmissions(ctx: LaborHistoryContext, filters: { profileId?: string; jobId?: string } = {}): Promise<LaborSubmissionListDto> {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => !['profileId', 'jobId'].includes(key))) throw new LaborHistoryError('Filtr není platný.', 'validation')
  const expected = { ...guard(ctx),
    ...(filters.profileId !== undefined ? { profileId: laborHistoryId(filters.profileId) } : {}),
    ...(filters.jobId !== undefined ? { jobId: laborHistoryId(filters.jobId) } : {}) }
  if (ctx.role === 'worker') {
    if (expected.profileId && expected.profileId !== expected.actorProfileId) forbidden()
    expected.profileId = expected.actorProfileId
  }
  return parseLaborSubmissionListDto(await rpc(ctx, 'list_labor_submissions', {
    target_company_id: expected.companyId, target_profile_id: expected.profileId ?? null, target_job_id: expected.jobId ?? null,
  }), expected, financialRoles.includes(ctx.role ?? ''))
}
export async function getLaborCostPreview(ctx: LaborHistoryContext, submissionId: string, versionId: string): Promise<LaborCostPreviewDto> {
  const expected = { ...guard(ctx), submissionId: laborHistoryId(submissionId), versionId: laborHistoryId(versionId) }
  if (ctx.role === 'worker') forbidden()
  return parseLaborCostPreviewDto(await rpc(ctx, 'get_labor_cost_preview', {
    target_company_id: expected.companyId, target_submission_id: expected.submissionId, target_version_id: expected.versionId,
  }), expected, financialRoles.includes(ctx.role ?? ''))
}
export async function saveLaborSubmissionDraft(ctx: LaborHistoryContext, value: LaborDraftInput): Promise<LaborSubmissionDto> {
  const input = parseLaborDraftInput(value)
  guard(ctx, input)
  if (ctx.role === 'worker' && input.profileId !== ctx.profileId) forbidden()
  return parseLaborMutationReceipt(await rpc(ctx, 'save_labor_submission_draft', {
    target_company_id: input.companyId,
    payload: { actor_profile_id: input.actorProfileId, operation_id: input.operationId, profile_id: input.profileId, job_id: input.jobId,
      expected_revision: Number(input.expectedRevision), ...(input.submissionId ? { submission_id: input.submissionId } : {}),
      ...(input.revisionOf ? { revision_of: input.revisionOf } : {}), correction_reason: input.correctionReason,
      sources: input.sources,
      lines: input.lines.map(line => ({ work_date: line.workDate, started_at: line.startedAt, ended_at: line.endedAt,
        actual_hours: line.actualHours, pay_hours: line.payHours, billed_hours: line.billedHours })),
    },
  }), input, 'draft', financialRoles.includes(ctx.role ?? ''))
}
export async function submitLaborSubmission(ctx: LaborHistoryContext, value: LaborSubmitInput): Promise<LaborSubmissionDto> {
  const input = parseLaborSubmitInput(value)
  guard(ctx, input)
  const result = parseLaborMutationReceipt(await rpc(ctx, 'submit_labor_submission', {
    target_company_id: input.companyId,
    payload: { actor_profile_id: input.actorProfileId, operation_id: input.operationId, submission_id: input.submissionId,
      version_id: input.versionId, expected_revision: Number(input.expectedRevision) },
  }), input, 'submit', financialRoles.includes(ctx.role ?? ''))
  if (ctx.role === 'worker' && result.profileId !== ctx.profileId) throw laborHistoryError(null)
  return result
}
export async function reviewLaborSubmission(ctx: LaborHistoryContext, value: LaborReviewInput): Promise<LaborSubmissionDto> {
  const input = parseLaborReviewInput(value)
  guard(ctx, input)
  if (ctx.role === 'worker') forbidden()
  return parseLaborMutationReceipt(await rpc(ctx, 'review_labor_submission', {
    target_company_id: input.companyId,
    payload: { actor_profile_id: input.actorProfileId, operation_id: input.operationId, submission_id: input.submissionId,
      version_id: input.versionId, expected_revision: Number(input.expectedRevision), decision: input.decision,
      reason: input.reason, expected_cost_preview_hash: input.expectedCostPreviewHash },
  }), input, 'review', financialRoles.includes(ctx.role ?? ''))
}


export async function getJobLaborCostTotals(ctx: LaborHistoryContext, value: string[]): Promise<JobLaborCostTotalsDto> {
  const expected = { ...guard(ctx, undefined, true), jobIds: parseLaborJobIds(value) }
  return parseJobLaborCostTotalsDto(await rpc(ctx, 'get_job_labor_cost_totals', {
    target_company_id: expected.companyId, job_ids: expected.jobIds,
  }), expected)
}

export async function listLaborSourceOptions(ctx: LaborHistoryContext, filters: { profileId?: string } = {}): Promise<LaborSourceOptionsDto> {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => key !== 'profileId')) throw new LaborHistoryError('Filtr není platný.', 'validation')
  const expected = { ...guard(ctx), ...(filters.profileId !== undefined ? { profileId: laborHistoryId(filters.profileId) } : {}) }
  if (ctx.role === 'worker') {
    if (expected.profileId && expected.profileId !== expected.actorProfileId) forbidden()
    expected.profileId = expected.actorProfileId
  }
  return parseLaborSourceOptionsDto(await rpc(ctx, 'list_labor_source_options', {
    target_company_id: expected.companyId, target_profile_id: expected.profileId ?? null,
  }), expected)
}
