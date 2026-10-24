import { describe, expect, it } from 'vitest'
import {
  LaborHistoryError, laborHistoryError, isLaborHistoryUnknownOutcome, normalizeLaborHours, normalizeLaborRate,
  parseLaborRateScheduleInput, parseLaborRateListDto, parseLaborRateMutationReceipt,
  parseLaborSourceOptionsDto, parseLaborDraftInput, parseLaborSubmitInput, parseLaborReviewInput,
  parseLaborSubmissionDto, parseLaborSubmissionListDto, parseLaborMutationReceipt, parseLaborCostPreviewDto, parseLaborJobIds, parseJobLaborCostTotalsDto,
} from '../lib/labor-history'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const actorProfileId = 'b1111111-1111-4111-8111-111111111111'
const profileId = 'c1111111-1111-4111-8111-111111111111'
const operationId = 'd1111111-1111-4111-8111-111111111111'
const jobId = 'e1111111-1111-4111-8111-111111111111'
const id = 'f1111111-1111-4111-8111-111111111111'
const versionId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-1111-4111-8111-111111111111'
const scope = { companyId, actorProfileId, operationId }
const rateInput = () => ({ ...scope, profileId, expectedRevision: '0', effectiveFrom: '2026-11-01',
  hourlyRate: '0.00', currency: 'CZK', unit: 'hour' as const, workerType: 'employee' as const,
  billingType: 'hourly' as const, reason: 'Výslovná nulová nákladová sazba' })
const storedRate = () => ({ id, effective_from: '2026-11-01', amount: '0.00', currency: 'CZK', unit: 'hour',
  worker_type: 'employee', billing_type: 'hourly', reason: rateInput().reason, created_at: '2026-10-24T10:00:00+00:00' })
const timeLine = () => ({ workDate: '2026-10-20', startedAt: '2026-10-20T08:00:00+02:00',
  endedAt: '2026-10-20T09:00:00+02:00', actualHours: '1.0000', payHours: '2.0000', billedHours: '0.0000' })
const draft = () => ({ ...scope, submissionId: null, profileId, jobId, expectedRevision: '0',
  revisionOf: null, correctionReason: null, sources: [{ kind: 'shift' as const, id: sourceId }], lines: [timeLine()] })
const submit = () => ({ ...scope, submissionId: id, versionId, expectedRevision: '1' })
const cost = () => ({ currency: 'CZK', amount: '0.00', lines: [{ line_no: 1, rate_version_id: sourceId,
  rate_amount: '0.00', currency: 'CZK', unit: 'hour', worker_type: 'employee', billing_type: 'hourly',
  cost_quantity: '2.0000', cost_amount: '0.00' }] })
function dto(state = 'draft', financial = false) {
  return { id, company_id: companyId, profile_id: profileId, job_id: jobId, revision: 1,
    current_version_id: versionId, approved_version_id: state === 'approved' ? versionId : null,
    sources: [{ kind: 'shift', id: sourceId }],
    versions: [{ id: versionId, version: 1, state, revision_of: null, correction_reason: null,
      created_at: '2026-10-24T10:00:00Z', submitted_at: state === 'draft' ? null : '2026-10-24T10:01:00Z',
      reviewed_at: ['approved', 'returned'].includes(state) ? '2026-10-24T10:02:00Z' : null, review_reason: null,
      lines: [{ line_no: 1, work_date: '2026-10-20', started_at: timeLine().startedAt, ended_at: timeLine().endedAt,
        actual_hours: '1.0000', pay_hours: '2.0000', billed_hours: '0.0000' }],
      ...(financial ? { cost: state === 'approved' ? cost() : null } : {}) }] }
}
function fails(run: () => unknown, code: string, uncertain: boolean) {
  try { run(); throw new Error('Expected a failure') } catch (error) {
    expect(error).toBeInstanceOf(LaborHistoryError)
    expect(error).toMatchObject({ code, uncertain })
  }
}

describe('labor inputs never infer missing money or time', () => {
  it('keeps an explicit zero and normalizes decimal strings without floating point', () => {
    expect(parseLaborRateScheduleInput({ ...rateInput(), hourlyRate: '000,0' }).hourlyRate).toBe('0.00')
    expect(normalizeLaborRate('9999999999.99')).toBe('9999999999.99')
    expect(normalizeLaborHours('25')).toBe('25.0000')
  })
  it.each([null, undefined, '', ' ', 0, NaN, Infinity, '-1', '1e2', '0x10', '1.001', '10000000000', '1,2,3'])
    ('rejects unknown/invalid rate %s', value => fails(() => normalizeLaborRate(value), 'validation', false))
  it.each(['25.0001', '1.00001', '-0.1', 'Infinity', '', 1])
    ('rejects invalid hours %s', value => fails(() => normalizeLaborHours(value), 'validation', false))
  it.each(['2026-02-29', '2024-02-30', '2026-13-01', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00Z'])
    ('rejects invalid calendar date %s', effectiveFrom => fails(() => parseLaborRateScheduleInput({ ...rateInput(), effectiveFrom }), 'validation', false))
  it('accepts a real leap day', () => expect(parseLaborRateScheduleInput({ ...rateInput(), effectiveFrom: '2024-02-29' }).effectiveFrom).toBe('2024-02-29'))
  it.each(['companyId', 'actorProfileId', 'profileId', 'operationId'])('validates UUID field %s', field => {
    fails(() => parseLaborRateScheduleInput({ ...rateInput(), [field]: 'not-a-uuid' }), 'validation', false)
  })
  it.each(['-1', '1.2', '01', '2147483648', NaN])('bounds CAS revision %s', expectedRevision => {
    fails(() => parseLaborRateScheduleInput({ ...rateInput(), expectedRevision }), 'validation', false)
  })
  it.each(['', 'czk', 'CZ', 'CZKK', null])('requires explicit currency %s', currency => {
    fails(() => parseLaborRateScheduleInput({ ...rateInput(), currency }), 'validation', false)
  })
  it('rejects hidden fields, blank reasons, oversized notes and invalid enums', () => {
    for (const extra of [{ internalCost: '0' }, { reason: '' }, { reason: 'x'.repeat(2001) }, { unit: 'week' }, { workerType: 'admin' }]) {
      fails(() => parseLaborRateScheduleInput({ ...rateInput(), ...extra }), 'validation', false)
    }
  })
  it('retains independent actual/pay/billed hours including zero', () => {
    expect(parseLaborDraftInput(draft()).lines[0]).toMatchObject({ actualHours: '1.0000', payHours: '2.0000', billedHours: '0.0000' })
  })
  it('rejects duplicate or absent source references and too many lines', () => {
    for (const extra of [{ sources: [] }, { sources: [...draft().sources, ...draft().sources] }, { lines: [] }, { lines: Array.from({ length: 367 }, timeLine) }]) {
      fails(() => parseLaborDraftInput({ ...draft(), ...extra }), 'validation', false)
    }
  })
  it('rejects half timestamps, inverted interval, invalid clocks and hours inconsistent with elapsed time', () => {
    for (const extra of [{ endedAt: null }, { endedAt: '2026-10-20T07:00:00+02:00' }, { startedAt: '2026-10-20T24:00:00Z' },
      { startedAt: '2026-10-20T08:00:00' }, { actualHours: '2' }]) {
      fails(() => parseLaborDraftInput({ ...draft(), lines: [{ ...timeLine(), ...extra }] }), 'validation', false)
    }
  })
  it('compares sub-millisecond instants exactly at rounding boundaries', () => {
    const line = { ...timeLine(), startedAt: '2026-10-20T08:00:00.000999Z', endedAt: '2026-10-20T08:00:00.180998Z', actualHours: '0.0000' }
    expect(parseLaborDraftInput({ ...draft(), lines: [line] }).lines[0].actualHours).toBe('0.0000')
    fails(() => parseLaborDraftInput({ ...draft(), lines: [{ ...line, actualHours: '0.0001' }] }), 'validation', false)
  })
  it('requires revision and correction provenance', () => {
    fails(() => parseLaborDraftInput({ ...draft(), submissionId: id }), 'validation', false)
    fails(() => parseLaborDraftInput({ ...draft(), revisionOf: versionId }), 'validation', false)
    fails(() => parseLaborSubmitInput({ ...submit(), expectedRevision: '0' }), 'validation', false)
    fails(() => parseLaborReviewInput({ ...submit(), decision: 'approve' }), 'validation', false)
    fails(() => parseLaborReviewInput({ ...submit(), decision: 'return', reason: '' }), 'validation', false)
  })
})

describe('strict labor response boundaries', () => {
  const expected = { companyId, profileId }
  it('maps known zero without a profile/default fallback', () => {
    const list = parseLaborRateListDto({ company_id: companyId, profile_id: profileId, schedule_revision: 1,
      currency: 'CZK', company_name: 'Firma A', profile_name: 'Pracovník A', rates: [storedRate()] }, expected)
    expect(list.rates[0].hourlyRate).toBe('0.00')
    expect(list.revision).toBe('1')
  })
  it('verifies receipt actor, tenant, operation, worker, CAS and echoed rate content', () => {
    const input = parseLaborRateScheduleInput(rateInput())
    const receipt = { company_id: companyId, actor_profile_id: actorProfileId, profile_id: profileId,
      operation_id: operationId, schedule_revision: 1, rate: storedRate() }
    expect(parseLaborRateMutationReceipt(receipt, input)).toMatchObject({ rateId: id, revision: '1' })
    for (const field of ['company_id', 'actor_profile_id', 'profile_id', 'operation_id']) {
      fails(() => parseLaborRateMutationReceipt({ ...receipt, [field]: sourceId }, input), 'unknown', true)
    }
    for (const extra of [{ schedule_revision: 0 }, { schedule_revision: 2 }, { rate: { ...storedRate(), amount: '1.00' } }, { secret: 'private' }]) {
      fails(() => parseLaborRateMutationReceipt({ ...receipt, ...extra }, input), 'unknown', true)
    }
  })
  it('does not expose financial data through the time-only DTO, even null/extra nested fields', () => {
    expect(parseLaborSubmissionDto(dto(), { companyId, submissionId: id }, false).versions[0]).not.toHaveProperty('cost')
    fails(() => parseLaborSubmissionDto(dto('draft', true), { companyId, submissionId: id }, false), 'unknown', true)
    const leaked = dto(); Object.assign(leaked.versions[0].lines[0], { hourly_rate: '999' })
    fails(() => parseLaborSubmissionDto(leaked, { companyId, submissionId: id }, false), 'unknown', true)
  })
  it('keeps approved zero costs distinct from absent draft valuation', () => {
    expect(parseLaborSubmissionDto(dto('approved', true), { companyId, submissionId: id }, true).versions[0].cost?.amount).toBe('0.00')
    expect(parseLaborSubmissionDto(dto('draft', true), { companyId, submissionId: id }, true).versions[0].cost).toBeNull()
    const broken = dto('approved', true); broken.versions[0].cost = null
    fails(() => parseLaborSubmissionDto(broken, { companyId, submissionId: id }, true), 'unknown', true)
  })
  it('rejects foreign tenant/profile/version and inconsistent financial totals', () => {
    fails(() => parseLaborSubmissionDto(dto(), { companyId: sourceId, submissionId: id }, false), 'unknown', true)
    fails(() => parseLaborSubmissionDto(dto(), { companyId, submissionId: id, profileId: actorProfileId }, false), 'unknown', true)
    fails(() => parseLaborSubmissionDto({ ...dto(), current_version_id: sourceId }, { companyId, submissionId: id }, false), 'unknown', true)
    const wrongTotal = dto('approved', true); wrongTotal.versions[0].cost!.amount = '1.00'
    fails(() => parseLaborSubmissionDto(wrongTotal, { companyId, submissionId: id }, true), 'unknown', true)
  })
  it('validates every list row and rejects duplicate identities', () => {
    fails(() => parseLaborSubmissionListDto({ company_id: companyId, items: [{ ...dto(), company_id: sourceId }] }, { companyId }, false), 'unknown', true)
    fails(() => parseLaborSubmissionListDto({ company_id: companyId, items: [dto(), dto()] }, { companyId }, false), 'unknown', true)
  })
  it('binds submitted mutation acknowledgement to exact version and state', () => {
    const receipt = { ...dto('submitted'), revision: 2, operation_id: operationId, actor_profile_id: actorProfileId }
    expect(parseLaborMutationReceipt(receipt, submit(), 'submit', false).currentVersionId).toBe(versionId)
    fails(() => parseLaborMutationReceipt({ ...receipt, revision: 3 }, submit(), 'submit', false), 'unknown', true)
    fails(() => parseLaborMutationReceipt({ ...receipt, versions: dto().versions }, submit(), 'submit', false), 'unknown', true)
  })
  it('keeps incomplete known subtotal explicitly incomplete and blocks financial preview fields for managers', () => {
    const preview = { company_id: companyId, submission_id: id, version_id: versionId, preview_hash: 'a'.repeat(64),
      completeness: 'incomplete', reasons: ['missing_rate'], cost: { currency: 'CZK', amount: '0.00', lines: [] } }
    const expected = { companyId, submissionId: id, versionId }
    expect(parseLaborCostPreviewDto(preview, expected, true)).toMatchObject({ completeness: 'incomplete', cost: { amount: '0.00' } })
    fails(() => parseLaborCostPreviewDto(preview, expected, false), 'unknown', true)
    const { cost: knownCost, ...timeOnly } = preview
    expect(knownCost.amount).toBe('0.00')
    expect(parseLaborCostPreviewDto(timeOnly, expected, false)).not.toHaveProperty('cost')
    fails(() => parseLaborCostPreviewDto({ ...timeOnly, version_id: sourceId }, expected, false), 'unknown', true)
  })
})

describe('known database rejection versus unknown commit outcome', () => {
  it.each([['LABOR_REVISION_CONFLICT', 'conflict'], ['LABOR_OPERATION_CONFLICT', 'conflict'],
    ['LABOR_PREVIEW_CONFLICT', 'conflict'], ['LABOR_MISSING_RATE', 'validation'],
    ['LABOR_FORBIDDEN', 'forbidden'], ['LABOR_NOT_FOUND', 'forbidden']])('maps %s without internal details', (message, code) => {
    const error = laborHistoryError({ message, details: 'private internal salary' })
    expect(error).toMatchObject({ code, uncertain: false })
    expect(error.message).not.toContain('private')
  })
  it.each(['40001', 'PT409', '42501', '22023', '23514'])('keeps explicit database rejection %s certain', code => {
    expect(isLaborHistoryUnknownOutcome({ code, message: 'private SQL' })).toBe(false)
  })
  it('preserves unknown transport and malformed acknowledgement uncertainty', () => {
    expect(isLaborHistoryUnknownOutcome(new Error('private connection string'))).toBe(true)
    expect(laborHistoryError(new Error('private')).message).not.toContain('private')
  })
})


describe('DST days and separately billed hours', () => {
  it.each([
    ['2026-10-25', '2026-10-25T00:00:00+02:00', '2026-10-26T00:00:00+01:00', '25.0000'],
    ['2026-03-29', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00', '23.0000'],
  ])('accepts elapsed hours across the clock change on %s', (workDate, startedAt, endedAt, actualHours) => {
    const input = parseLaborDraftInput({ ...draft(), lines: [{ workDate, startedAt, endedAt, actualHours, payHours: '10', billedHours: '12' }] })
    expect(input.lines[0]).toMatchObject({ actualHours, payHours: '10.0000', billedHours: '12.0000' })
  })
  it('rejects elapsed time over 25 hours even when rounded actual hours remain 25', () => {
    fails(() => parseLaborDraftInput({ ...draft(), lines: [{ ...timeLine(), startedAt: '2026-10-25T00:00:00+02:00',
      endedAt: '2026-10-26T00:00:00.000001+01:00', actualHours: '25' }] }), 'validation', false)
  })
  it('rejects old ambiguous jobHours and wire job_hours fields', () => {
    fails(() => parseLaborDraftInput({ ...draft(), lines: [{ ...timeLine(), jobHours: '0' }] }), 'validation', false)
    const old = dto(); Object.assign(old.versions[0].lines[0], { job_hours: '0.0000' })
    fails(() => parseLaborSubmissionDto(old, { companyId, submissionId: id }, false), 'unknown', true)
  })
  it('validates hourly cost against pay hours, not actual or billed hours', () => {
    const paid = dto('approved', true)
    paid.versions[0].cost!.lines[0].rate_amount = '12.34'
    paid.versions[0].cost!.lines[0].cost_amount = '24.68'
    paid.versions[0].cost!.amount = '24.68'
    expect(parseLaborSubmissionDto(paid, { companyId, submissionId: id }, true).versions[0].cost?.amount).toBe('24.68')
    paid.versions[0].cost!.lines[0].cost_quantity = '0.0000'
    paid.versions[0].cost!.lines[0].cost_amount = '0.00'
    paid.versions[0].cost!.amount = '0.00'
    fails(() => parseLaborSubmissionDto(paid, { companyId, submissionId: id }, true), 'unknown', true)
  })
  it('rejects a cost product inconsistent by one cent', () => {
    const wrong = dto('approved', true)
    wrong.versions[0].cost!.lines[0].rate_amount = '12.34'
    wrong.versions[0].cost!.lines[0].cost_amount = '24.67'
    wrong.versions[0].cost!.amount = '24.67'
    fails(() => parseLaborSubmissionDto(wrong, { companyId, submissionId: id }, true), 'unknown', true)
  })
})

describe('canonical job labor totals preserve missing and unconverted costs', () => {
  const total = () => ({ job_id: jobId, currency: 'CZK', approved_cost: '100.00', approved_internal_cost: '60.00',
    approved_external_cost: '40.00', approved_hours: '50.0000', unconverted_costs: [] as { currency: string; amount: string }[],
    provisional_known_cost: '0', missing_rate_hours: '0', unapproved_hours: '0', legacy_unverified_count: 0,
    completeness: 'complete', reasons: [] as string[], total_cost: '100.00' as string | null })
  const parse = (item = total()) => parseJobLaborCostTotalsDto({ company_id: companyId, items: [item] }, { companyId, jobIds: [jobId] })
  it('normalizes exact totals and allows aggregate hours beyond a single day', () => {
    expect(parse().items[0]).toMatchObject({ approvedHours: '50.0000', approvedCost: '100.00', totalCost: '100.00', missingRateHours: '0.0000' })
  })
  it('keeps known zero subtotal, missing rate hours and nullable total separate', () => {
    expect(parse({ ...total(), completeness: 'incomplete', reasons: ['missing_rate', 'unapproved_work'],
      provisional_known_cost: '0.00', missing_rate_hours: '25.0000', unapproved_hours: '23', total_cost: null }).items[0])
      .toMatchObject({ completeness: 'incomplete', provisionalKnownCost: '0.00', missingRateHours: '25.0000', unapprovedHours: '23.0000', totalCost: null })
  })
  it('does not silently convert foreign-currency amounts or mark them as missing hours', () => {
    expect(parse({ ...total(), unconverted_costs: [{ currency: 'EUR', amount: '20.00' }], completeness: 'incomplete',
      reasons: ['currency_mismatch'], total_cost: null }).items[0])
      .toMatchObject({ approvedCost: '100.00', unconvertedCosts: [{ currency: 'EUR', amount: '20.00' }], missingRateHours: '0.0000', totalCost: null })
  })
  it('retains known provisional subtotal without promoting it to approved cost', () => {
    expect(parse({ ...total(), provisional_known_cost: '12.34', unapproved_hours: '2',
      completeness: 'provisional', reasons: ['unapproved_work'], total_cost: null }).items[0])
      .toMatchObject({ approvedCost: '100.00', provisionalKnownCost: '12.34', totalCost: null })
  })
  it('keeps large aggregates exact beyond Number precision', () => {
    const large = '9007199254740993.01'
    expect(parse({ ...total(), approved_cost: large, approved_internal_cost: large, approved_external_cost: '0', total_cost: large }).items[0].totalCost).toBe(large)
  })
  it.each([
    { approved_cost: '99.99' }, { total_cost: null }, { completeness: 'incomplete', total_cost: null },
    { unconverted_costs: [{ currency: 'EUR', amount: '0' }] }, { missing_rate_hours: '1' },
    { legacy_unverified_count: 1 }, { approved_cost: NaN }, { approved_hours: 'Infinity' },
    { unconverted_costs: [{ currency: 'CZK', amount: '1' }] }, { internal_profile_rate: '999' },
  ])('rejects inconsistent or unsupported totals: %s', extra => {
    fails(() => parse({ ...total(), ...extra } as ReturnType<typeof total>), 'unknown', true)
  })
  it('requires the exact requested tenant and complete job set', () => {
    fails(() => parseJobLaborCostTotalsDto({ company_id: sourceId, items: [total()] }, { companyId, jobIds: [jobId] }), 'unknown', true)
    fails(() => parseJobLaborCostTotalsDto({ company_id: companyId, items: [] }, { companyId, jobIds: [jobId] }), 'unknown', true)
    fails(() => parseJobLaborCostTotalsDto({ company_id: companyId, items: [total(), total()] }, { companyId, jobIds: [jobId, sourceId] }), 'unknown', true)
    fails(() => parseJobLaborCostTotalsDto({ company_id: companyId, items: [{ ...total(), job_id: sourceId }] }, { companyId, jobIds: [jobId] }), 'unknown', true)
  })
  it('rejects excessive, duplicate or malformed requested IDs before an RPC', () => {
    for (const input of [[jobId, jobId], ['bad'], Array(501).fill(jobId), null]) {
      fails(() => parseLaborJobIds(input), 'validation', false)
    }
    expect(parseLaborJobIds([])).toEqual([])
  })
})


describe('time-only source picker DTO', () => {
  const item = () => ({ kind: 'shift', id: sourceId, profile_id: profileId, profile_name: 'Pracovník',
    job_id: jobId, job_title: 'Zakázka', work_date: '2026-10-25', started_at: null, ended_at: null,
    actual_hours: null as string | null, submission_id: null as string | null })
  const parse = (items = [item()]) => parseLaborSourceOptionsDto({ company_id: companyId, company_name: 'Firma', items }, { companyId })
  it('keeps unknown hours null and explicit zero known', () => {
    expect(parse().items[0].actualHours).toBeNull()
    expect(parse([{ ...item(), actual_hours: '0' }]).items[0].actualHours).toBe('0.0000')
  })
  it('keeps claimed source linkage for history without turning it into a new source', () => {
    expect(parse([{ ...item(), submission_id: id }]).items[0].submissionId).toBe(id)
  })
  it('rejects private financial fields, invalid hours and ambiguous duplicate sources', () => {
    for (const extra of [{ rate: '123' }, { actual_hours: '25.0001' }, { actual_hours: 'NaN' }, { kind: 'invoice' },
      { started_at: '2026-10-25T01:00:00Z' }, { profile_id: 'broken' }]) {
      fails(() => parse([{ ...item(), ...extra }] as ReturnType<typeof item>[]), 'unknown', true)
    }
    fails(() => parse([item(), item()]), 'unknown', true)
    fails(() => parse(Array(2001).fill(item())), 'unknown', true)
  })
  it('requires the expected tenant and optional worker scope', () => {
    fails(() => parseLaborSourceOptionsDto({ company_id: sourceId, company_name: 'Other', items: [] }, { companyId }), 'unknown', true)
    fails(() => parseLaborSourceOptionsDto({ company_id: companyId, company_name: 'Firma', items: [item()] },
      { companyId, profileId: actorProfileId }), 'unknown', true)
  })
  it('classifies a source-picker limit as explicit rejection rather than unknown write outcome', () => {
    expect(laborHistoryError({ code: '54000', message: 'LABOR_SOURCE_OPTIONS_LIMIT' })).toMatchObject({ code: 'validation', uncertain: false })
  })
})
