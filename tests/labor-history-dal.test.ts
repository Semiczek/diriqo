import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  getLaborSubmission, listLaborSubmissions, getLaborCostPreview, saveLaborSubmissionDraft,
  submitLaborSubmission, reviewLaborSubmission, listLaborRates, scheduleLaborRate,
  listLaborSourceOptions, getJobLaborCostTotals, type LaborHistoryContext,
} from '../lib/dal/labor-history'
import { parseLaborDraftInput, parseLaborRateScheduleInput, parseLaborReviewInput, parseLaborSubmitInput } from '../lib/labor-history'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const actorProfileId = 'b1111111-1111-4111-8111-111111111111'
const profileId = 'c1111111-1111-4111-8111-111111111111'
const operationId = 'd1111111-1111-4111-8111-111111111111'
const jobId = 'e1111111-1111-4111-8111-111111111111'
const submissionId = 'f1111111-1111-4111-8111-111111111111'
const versionId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-1111-4111-8111-111111111111'
const scope = { companyId, actorProfileId, operationId }
const rateInput = () => parseLaborRateScheduleInput({ ...scope, profileId, expectedRevision: '0',
  effectiveFrom: '2026-11-01', hourlyRate: '100,10', currency: 'CZK', unit: 'hour',
  workerType: 'employee', billingType: 'hourly', reason: 'Platná sjednaná sazba' })
const rateDto = () => ({ id: sourceId, effective_from: '2026-11-01', amount: '100.10', currency: 'CZK',
  unit: 'hour', worker_type: 'employee', billing_type: 'hourly', reason: rateInput().reason, created_at: '2026-10-24T10:00:00Z' })
const rateReceipt = () => ({ company_id: companyId, profile_id: profileId, actor_profile_id: actorProfileId,
  operation_id: operationId, schedule_revision: 1, rate: rateDto() })
const draft = () => parseLaborDraftInput({ ...scope, profileId, jobId, expectedRevision: '0',
  sources: [{ kind: 'shift', id: sourceId }], lines: [{ workDate: '2026-10-24', actualHours: '1',
    payHours: '2', billedHours: '0', startedAt: '2026-10-24T08:00:00+02:00', endedAt: '2026-10-24T09:00:00+02:00' }] })
const submit = () => parseLaborSubmitInput({ ...scope, submissionId, versionId, expectedRevision: '1' })
const review = () => parseLaborReviewInput({ ...submit(), decision: 'return', reason: 'Doplňte popis práce' })
function detail(state = 'draft', financial = false, mutation = false) {
  return { id: submissionId, company_id: companyId, profile_id: profileId, job_id: jobId, revision: mutation && state !== 'draft' ? 2 : 1,
    current_version_id: versionId, approved_version_id: null, sources: [{ kind: 'shift', id: sourceId }],
    ...(mutation ? { actor_profile_id: actorProfileId, operation_id: operationId } : {}),
    versions: [{ id: versionId, version: 1, state, revision_of: null, correction_reason: null,
      created_at: '2026-10-24T10:00:00+00:00', submitted_at: state === 'draft' ? null : '2026-10-24T10:01:00+00:00',
      reviewed_at: state === 'returned' ? '2026-10-24T10:02:00+00:00' : null,
      review_reason: state === 'returned' ? review().reason : null,
      lines: [{ line_no: 1, work_date: '2026-10-24', actual_hours: '1.0000', pay_hours: '2.0000', billed_hours: '0.0000',
        started_at: '2026-10-24T06:00:00+00:00', ended_at: '2026-10-24T07:00:00+00:00' }],
      ...(financial ? { cost: null } : {}) }] }
}
function mockContext(role = 'company_admin', data: unknown = rateReceipt()) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: actorProfileId } }, error: null })
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  const from = vi.fn(() => { throw new Error('Direct tables are not an allowed write path') })
  const ctx = { companyId, profileId: actorProfileId, role, supabase: { auth: { getUser }, rpc, from } } as unknown as LaborHistoryContext
  return { ctx, getUser, rpc, from }
}

describe('labor DAL scoped rate schedule', () => {
  it('uses fresh authentication and one atomic RPC, preserving exact decimal, CAS and actor pins', async () => {
    const mock = mockContext()
    expect(await scheduleLaborRate(mock.ctx, rateInput())).toEqual({ companyId, profileId, operationId, revision: '1', rateId: sourceId })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('set_company_worker_rate', {
      target_company_id: companyId, payload: { actor_profile_id: actorProfileId, profile_id: profileId,
        expected_schedule_revision: 0, effective_from: '2026-11-01', amount: '100.10', currency: 'CZK',
        unit: 'hour', worker_type: 'employee', billing_type: 'hourly', reason: rateInput().reason, operation_id: operationId },
    })
    expect(mock.getUser).toHaveBeenCalledOnce()
    expect(mock.getUser.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0])
    expect(mock.from).not.toHaveBeenCalled()
  })
  it.each(['company_admin', 'super_admin'])('allows only finance authority %s to read rate schedules', async role => {
    const mock = mockContext(role, { company_id: companyId, profile_id: profileId, schedule_revision: 1,
      currency: 'CZK', company_name: 'Firma A', profile_name: 'Pracovník B', rates: [rateDto()] })
    expect(await listLaborRates(mock.ctx, profileId)).toMatchObject({ companyId, profileId, companyName: 'Firma A', profileName: 'Pracovník B' })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('list_company_worker_rates', { target_company_id: companyId, target_profile_id: profileId })
  })
  it.each(['worker', 'manager', 'customer', ''])('rejects finance role %s before any RPC', async role => {
    const mock = mockContext(role)
    await expect(listLaborRates(mock.ctx, profileId)).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    await expect(scheduleLaborRate(mock.ctx, rateInput())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.getUser).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it.each(['companyId', 'actorProfileId'])('rejects a stale rendered %s before writing', async field => {
    const mock = mockContext()
    await expect(scheduleLaborRate(mock.ctx, { ...rateInput(), [field]: sourceId })).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('does not write without a current authenticated user', async () => {
    const mock = mockContext()
    mock.getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(scheduleLaborRate(mock.ctx, rateInput())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it.each([{ code: '40001', message: 'LABOR_REVISION_CONFLICT' }, { code: 'PT409', message: 'internal detail' }])
    ('keeps an explicit CAS rejection certain: %s', async error => {
      const mock = mockContext()
      mock.rpc.mockResolvedValue({ data: null, error })
      await expect(scheduleLaborRate(mock.ctx, rateInput())).rejects.toMatchObject({ code: 'conflict', uncertain: false })
    })
  it('preserves the same operation and command when retrying an unknown transport outcome', async () => {
    const mock = mockContext()
    mock.rpc.mockRejectedValueOnce(new Error('private transport failure'))
    await expect(scheduleLaborRate(mock.ctx, rateInput())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    await expect(scheduleLaborRate(mock.ctx, rateInput())).resolves.toMatchObject({ operationId, revision: '1' })
    expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[0])
  })
  it.each([null, { ...rateReceipt(), actor_profile_id: sourceId }, { ...rateReceipt(), operation_id: sourceId },
    { ...rateReceipt(), schedule_revision: 3 }, { ...rateReceipt(), rate: { ...rateDto(), amount: '100.11' } }])
    ('does not acknowledge malformed or foreign committed results: %s', async data => {
      const mock = mockContext('company_admin', data)
      await expect(scheduleLaborRate(mock.ctx, rateInput())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    })
  it('does not fill missing currency, rates or names from global profile settings', async () => {
    const mock = mockContext('company_admin', { company_id: companyId, profile_id: profileId, schedule_revision: 0, rates: [] })
    await expect(listLaborRates(mock.ctx, profileId)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    expect(mock.from).not.toHaveBeenCalled()
  })
})

describe('labor DAL time visibility and versioned operations', () => {
  it('reads manager time without cost fields and rejects even null financial leakage', async () => {
    const mock = mockContext('manager', detail())
    expect((await getLaborSubmission(mock.ctx, submissionId)).versions[0]).not.toHaveProperty('cost')
    expect(mock.rpc).toHaveBeenLastCalledWith('get_labor_submission', { target_company_id: companyId, target_submission_id: submissionId })
    mock.rpc.mockResolvedValueOnce({ data: detail('draft', true), error: null })
    await expect(getLaborSubmission(mock.ctx, submissionId)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('restricts worker lists and verifies every returned row belongs to that worker', async () => {
    const own = { ...detail(), profile_id: actorProfileId }
    const mock = mockContext('worker', { company_id: companyId, items: [own] })
    expect((await listLaborSubmissions(mock.ctx, { jobId })).items[0].profileId).toBe(actorProfileId)
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('list_labor_submissions', {
      target_company_id: companyId, target_profile_id: actorProfileId, target_job_id: jobId,
    })
    mock.rpc.mockResolvedValueOnce({ data: { company_id: companyId, items: [detail()] }, error: null })
    await expect(listLaborSubmissions(mock.ctx)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    const calls = mock.rpc.mock.calls.length
    await expect(listLaborSubmissions(mock.ctx, { profileId })).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).toHaveBeenCalledTimes(calls)
  })
  it('rejects a worker detail for another worker', async () => {
    const mock = mockContext('worker', detail())
    await expect(getLaborSubmission(mock.ctx, submissionId)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('maps draft content, independent zero billed hours and UTC acknowledgements without float conversion', async () => {
    const mock = mockContext('manager', detail('draft', false, true))
    const result = await saveLaborSubmissionDraft(mock.ctx, draft())
    expect(result.versions[0].lines[0]).toMatchObject({ actualHours: '1.0000', payHours: '2.0000', billedHours: '0.0000' })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('save_labor_submission_draft', {
      target_company_id: companyId, payload: { actor_profile_id: actorProfileId, operation_id: operationId,
        profile_id: profileId, job_id: jobId, expected_revision: 0, correction_reason: null,
        sources: draft().sources, lines: [{ work_date: '2026-10-24', started_at: '2026-10-24T08:00:00+02:00',
          ended_at: '2026-10-24T09:00:00+02:00', actual_hours: '1.0000', pay_hours: '2.0000', billed_hours: '0.0000' }] },
    })
    expect(mock.from).not.toHaveBeenCalled()
  })
  it('does not acknowledge draft hours or source provenance different from the command', async () => {
    const wrong = detail('draft', false, true)
    wrong.versions[0].lines[0].billed_hours = '1.0000'
    const mock = mockContext('manager', wrong)
    await expect(saveLaborSubmissionDraft(mock.ctx, draft())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    mock.rpc.mockResolvedValueOnce({ data: { ...detail('draft', false, true), sources: [{ kind: 'log', id: sourceId }] }, error: null })
    await expect(saveLaborSubmissionDraft(mock.ctx, draft())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('submits exactly the specified version and refuses a foreign worker acknowledgement', async () => {
    const mock = mockContext('worker', { ...detail('submitted', false, true), profile_id: actorProfileId })
    expect((await submitLaborSubmission(mock.ctx, submit())).revision).toBe('2')
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('submit_labor_submission', {
      target_company_id: companyId, payload: { actor_profile_id: actorProfileId, operation_id: operationId,
        submission_id: submissionId, version_id: versionId, expected_revision: 1 },
    })
    mock.rpc.mockResolvedValueOnce({ data: detail('submitted', false, true), error: null })
    await expect(submitLaborSubmission(mock.ctx, submit())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('allows a manager to return time with a reason and no financial DTO', async () => {
    const mock = mockContext('manager', detail('returned', false, true))
    expect((await reviewLaborSubmission(mock.ctx, review())).versions[0]).toMatchObject({ state: 'returned', reviewReason: review().reason })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('review_labor_submission', {
      target_company_id: companyId, payload: { actor_profile_id: actorProfileId, operation_id: operationId,
        submission_id: submissionId, version_id: versionId, expected_revision: 1, decision: 'return',
        reason: review().reason, expected_cost_preview_hash: null },
    })
  })
  it('uses a preview hash and preserves an incomplete manager preview without finances', async () => {
    const mock = mockContext('manager', { company_id: companyId, submission_id: submissionId, version_id: versionId,
      preview_hash: 'a'.repeat(64), completeness: 'incomplete', reasons: ['missing_rate'] })
    const result = await getLaborCostPreview(mock.ctx, submissionId, versionId)
    expect(result).toMatchObject({ completeness: 'incomplete', reasons: ['missing_rate'] })
    expect(result).not.toHaveProperty('cost')
    expect(result).not.toHaveProperty('actorProfileId')
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('get_labor_cost_preview', {
      target_company_id: companyId, target_submission_id: submissionId, target_version_id: versionId,
    })
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'LABOR_MISSING_RATE' } })
    await expect(reviewLaborSubmission(mock.ctx, parseLaborReviewInput({ ...submit(), decision: 'approve', expectedCostPreviewHash: result.previewHash })))
      .rejects.toMatchObject({ code: 'validation', uncertain: false })
    expect(mock.rpc.mock.lastCall?.[1]).toMatchObject({ payload: { expected_cost_preview_hash: 'a'.repeat(64), decision: 'approve' } })
  })
  it('blocks workers from reviewing time, previewing costs or writing another worker draft', async () => {
    const mock = mockContext('worker')
    await expect(reviewLaborSubmission(mock.ctx, review())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    await expect(getLaborCostPreview(mock.ctx, submissionId, versionId)).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    await expect(saveLaborSubmissionDraft(mock.ctx, draft())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('validates read IDs and strict filters before calling the database', async () => {
    const mock = mockContext('manager')
    await expect(getLaborSubmission(mock.ctx, '')).rejects.toMatchObject({ code: 'validation', uncertain: false })
    await expect(listLaborSubmissions(mock.ctx, { jobId: '' })).rejects.toMatchObject({ code: 'validation', uncertain: false })
    await expect(listLaborSubmissions(mock.ctx, { companyId: sourceId } as never)).rejects.toMatchObject({ code: 'validation', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
  })
})


describe('canonical job cost DAL', () => {
  const total = () => ({ job_id: jobId, currency: 'CZK', approved_cost: '0', approved_internal_cost: '0',
    approved_external_cost: '0', approved_hours: '0', unconverted_costs: [], provisional_known_cost: '100.00',
    missing_rate_hours: '2.0000', unapproved_hours: '3.0000', legacy_unverified_count: 0,
    completeness: 'incomplete', reasons: ['missing_rate', 'unapproved_work'], total_cost: null })
  it('reads canonical costs once and preserves partial totals without a legacy fallback', async () => {
    const mock = mockContext('company_admin', { company_id: companyId, items: [total()] })
    expect((await getJobLaborCostTotals(mock.ctx, [jobId])).items[0]).toMatchObject({
      approvedCost: '0.00', provisionalKnownCost: '100.00', missingRateHours: '2.0000', completeness: 'incomplete', totalCost: null,
    })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('get_job_labor_cost_totals', { target_company_id: companyId, job_ids: [jobId] })
    expect(mock.getUser).toHaveBeenCalledOnce()
    expect(mock.from).not.toHaveBeenCalled()
  })
  it.each(['worker', 'manager', 'customer'])('denies financial totals to %s', async role => {
    const mock = mockContext(role)
    await expect(getJobLaborCostTotals(mock.ctx, [jobId])).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('validates IDs before RPC and refuses partial, duplicate or foreign response sets', async () => {
    const mock = mockContext()
    await expect(getJobLaborCostTotals(mock.ctx, [jobId, jobId])).rejects.toMatchObject({ code: 'validation', uncertain: false })
    await expect(getJobLaborCostTotals(mock.ctx, Array(501).fill(jobId))).rejects.toMatchObject({ code: 'validation', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
    for (const data of [{ company_id: companyId, items: [] }, { company_id: companyId, items: [{ ...total(), job_id: sourceId }] },
      { company_id: sourceId, items: [total()] }]) {
      mock.rpc.mockResolvedValueOnce({ data, error: null })
      await expect(getJobLaborCostTotals(mock.ctx, [jobId])).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    }
  })
})


describe('labor source picker DAL', () => {
  const option = () => ({ kind: 'shift', id: sourceId, profile_id: actorProfileId, profile_name: 'Pracovník',
    job_id: jobId, job_title: 'Zakázka', work_date: '2026-10-25', started_at: null, ended_at: null, actual_hours: null, submission_id: null })
  it('forces worker own scope and never populates unknown time with zero', async () => {
    const mock = mockContext('worker', { company_id: companyId, company_name: 'Firma', items: [option()] })
    expect((await listLaborSourceOptions(mock.ctx)).items[0].actualHours).toBeNull()
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('list_labor_source_options', {
      target_company_id: companyId, target_profile_id: actorProfileId,
    })
    await expect(listLaborSourceOptions(mock.ctx, { profileId })).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(mock.rpc).toHaveBeenCalledOnce()
    expect(mock.from).not.toHaveBeenCalled()
  })
  it('allows a manager to select a worker in the active company and validates returned scope', async () => {
    const mock = mockContext('manager', { company_id: companyId, company_name: 'Firma', items: [{ ...option(), profile_id: profileId }] })
    expect((await listLaborSourceOptions(mock.ctx, { profileId })).items[0].profileId).toBe(profileId)
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('list_labor_source_options', { target_company_id: companyId, target_profile_id: profileId })
    mock.rpc.mockResolvedValueOnce({ data: { company_id: companyId, company_name: 'Firma', items: [option()] }, error: null })
    await expect(listLaborSourceOptions(mock.ctx, { profileId })).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
  it('rejects unexpected filter fields and financial response fields', async () => {
    const mock = mockContext('manager')
    await expect(listLaborSourceOptions(mock.ctx, { jobId } as never)).rejects.toMatchObject({ code: 'validation', uncertain: false })
    expect(mock.rpc).not.toHaveBeenCalled()
    mock.rpc.mockResolvedValueOnce({ data: { company_id: companyId, company_name: 'Firma', items: [{ ...option(), cost: null }] }, error: null })
    await expect(listLaborSourceOptions(mock.ctx)).rejects.toMatchObject({ code: 'unknown', uncertain: true })
  })
})
