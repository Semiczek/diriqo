import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  laborHistoryError, parseJobLaborCostTotalsDto, parseLaborCostPreviewDto, parseLaborDraftInput, parseLaborMutationReceipt,
  parseLaborRateListDto, parseLaborRateMutationReceipt, parseLaborRateScheduleInput, parseLaborReviewInput,
  parseLaborSourceOptionsDto, parseLaborSubmissionDto, parseLaborSubmissionListDto, parseLaborSubmitInput,
} from '../lib/labor-history'

// The pinned development dependency runs the real SQL in every ordinary test/CI run.
// LABOR_SQL_EVIDENCE reads a previously captured owner-run hosted rollback result.
// Neither mode installs packages or contacts a hosted database from this test process.
type Contract = {
  name: string; kind: string; data: unknown; financial: boolean; input: Record<string, unknown> | null
  expected: { companyId: string; profileId?: string; submissionId?: string; versionId?: string; jobIds?: string[] }
}
type Report = { count: number; cleanup_assertions: number; fixtures: string; contractCases: number; contracts: Contract[]; domain_conflicts: { code: string; message: string }[] }
const cases = [
  'rate list empty', 'rate receipt', 'rate list populated', 'draft receipt', 'submit receipt',
  'admin complete preview', 'approve receipt', 'approved detail snapshot', 'return receipt with historical approval',
  'revision approved detail', 'provisional totals', 'admin missing-rate preview', 'partial known and missing totals',
  'multi-currency totals', 'fixed approved totals', 'legacy incomplete totals', 'manager detail', 'manager preview',
  'worker detail', 'admin source picker', 'worker source picker', 'manager source picker', 'manager submission list', 'admin submission list',
  'running work incomplete totals', 'legacy fixed incomplete totals',
]
function required(value: string | undefined): string {
  if (!value) throw new Error('Missing expected scope in SQL contract evidence')
  return value
}
function parseContract(c: Contract): unknown {
  const e = c.expected
  if (c.kind === 'rate-list') return parseLaborRateListDto(c.data, { companyId: e.companyId, profileId: required(e.profileId) })
  if (c.kind === 'detail') return parseLaborSubmissionDto(c.data, { companyId: e.companyId, submissionId: required(e.submissionId) }, c.financial)
  if (c.kind === 'list') return parseLaborSubmissionListDto(c.data, e, c.financial)
  if (c.kind === 'preview') return parseLaborCostPreviewDto(c.data, { companyId: e.companyId, submissionId: required(e.submissionId), versionId: required(e.versionId) }, c.financial)
  if (c.kind === 'totals') return parseJobLaborCostTotalsDto(c.data, { companyId: e.companyId, jobIds: e.jobIds! })
  if (c.kind === 'picker') return parseLaborSourceOptionsDto(c.data, e)
  const p = c.input
  if (!p) throw new Error('Missing original RPC input')
  const scope = { companyId: e.companyId, actorProfileId: p.actor_profile_id, operationId: p.operation_id }
  if (c.kind === 'rate-receipt') {
    const input = parseLaborRateScheduleInput({ ...scope, profileId: p.profile_id, expectedRevision: p.expected_schedule_revision,
      effectiveFrom: p.effective_from, hourlyRate: p.amount, currency: p.currency, unit: p.unit,
      workerType: p.worker_type, billingType: p.billing_type, reason: p.reason })
    return parseLaborRateMutationReceipt(c.data, input)
  }
  if (c.kind === 'draft') {
    const input = parseLaborDraftInput({ ...scope, profileId: p.profile_id, jobId: p.job_id, expectedRevision: p.expected_revision,
      submissionId: p.submission_id, revisionOf: p.revision_of, correctionReason: p.correction_reason, sources: p.sources,
      lines: (p.lines as Record<string, unknown>[]).map(line => ({ workDate: line.work_date, actualHours: line.actual_hours,
        payHours: line.pay_hours, billedHours: line.billed_hours, startedAt: line.started_at, endedAt: line.ended_at })) })
    return parseLaborMutationReceipt(c.data, input, 'draft', c.financial)
  }
  const common = { ...scope, submissionId: p.submission_id, versionId: p.version_id, expectedRevision: p.expected_revision }
  if (c.kind === 'submit') return parseLaborMutationReceipt(c.data, parseLaborSubmitInput(common), 'submit', c.financial)
  if (c.kind === 'review') return parseLaborMutationReceipt(c.data, parseLaborReviewInput({ ...common, decision: p.decision,
    reason: p.reason, expectedCostPreviewHash: p.expected_cost_preview_hash }), 'review', c.financial)
  throw new Error('Unknown SQL contract case: ' + c.kind)
}

describe('actual rollback SQL JSON through production labor parsers', () => {
  let report: Report
  beforeAll(() => {
    const evidencePath = process.env.LABOR_SQL_EVIDENCE
    if (evidencePath) {
      if (!path.isAbsolute(evidencePath)) throw new Error('LABOR_SQL_EVIDENCE must be an absolute private artifact path')
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as { result: Report }
      report = { ...evidence.result, contractCases: evidence.result.contracts.length }
    } else {
      report = JSON.parse(execFileSync(process.execPath, [path.resolve('scripts/test-labor-history-sql.mjs'), '--contract-json'], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: process.env,
      })) as Report
    }
    expect(report).toMatchObject({ count: 99, cleanup_assertions: 5, fixtures: 'rolled_back', contractCases: cases.length })
    expect(report.contracts.map(c => c.name).sort()).toEqual([...cases].sort())
  }, 35_000)
  it.each(cases)('accepts unmodified SQL DTO: %s', name => {
    const c = report.contracts.find(row => row.name === name)!
    expect(parseContract(c)).toBeDefined()
  })
  it('maps all actual SQL domain conflicts to known application conflicts', () => {
    expect(report.domain_conflicts).toHaveLength(9)
    expect(report.domain_conflicts.map(error => error.message).sort()).toEqual([
      'LABOR_OPERATION_CONFLICT', 'LABOR_REVISION_CONFLICT', 'LABOR_EFFECTIVE_DATE_CONFLICT',
      'LABOR_REVISION_CONFLICT', 'LABOR_REVISION_CONFLICT', 'LABOR_REVISION_CONFLICT',
      'LABOR_SOURCE_CHANGED', 'LABOR_PREVIEW_CONFLICT', 'LABOR_SOURCE_CHANGED',
    ].sort())
    for (const error of report.domain_conflicts) {
      expect(error.code).toBe('PT409')
      expect(laborHistoryError(error)).toMatchObject({ code: 'conflict', uncertain: false })
    }
  })
  it('preserves the revised current cost while retaining the original immutable amount', () => {
    const c = report.contracts.find(row => row.name === 'revision approved detail')!
    const dto = parseLaborSubmissionDto(c.data, { companyId: c.expected.companyId, submissionId: required(c.expected.submissionId) }, true)
    expect(dto.versions[0].cost?.amount).toBe('1600.00')
    expect(dto.versions.find(v => v.id === dto.approvedVersionId)?.cost?.amount).toBe('1400.00')
  })
  it('retains a known provisional subtotal alongside missing-rate hours without inventing a total', () => {
    const c = report.contracts.find(row => row.name === 'partial known and missing totals')!
    const dto = parseJobLaborCostTotalsDto(c.data, { companyId: c.expected.companyId, jobIds: c.expected.jobIds! }).items[0]
    expect(dto.completeness).toBe('incomplete')
    expect(dto.totalCost).toBeNull()
    expect(dto.missingRateHours).toBe('8.0000')
    expect(BigInt(dto.provisionalKnownCost.replace('.', ''))).toBeGreaterThan(BigInt(0))
  })
  it('keeps foreign snapshot money outside the local job subtotal', () => {
    const c = report.contracts.find(row => row.name === 'multi-currency totals')!
    const dto = parseJobLaborCostTotalsDto(c.data, { companyId: c.expected.companyId, jobIds: c.expected.jobIds! }).items[0]
    expect(dto).toMatchObject({ currency: 'EUR', approvedCost: '0.00', totalCost: null,
      unconvertedCosts: [{ currency: 'CZK', amount: '1400.00' }] })
  })
})
