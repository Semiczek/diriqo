import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseAssignmentBatchOutcome, parseAssignmentBatchReceipt, parseAssignmentBatchWorkspace } from '../lib/job-assignment-batch'

type Contract = {
  name: string; kind: 'workspace' | 'receipt' | 'outcome'; data: unknown
  expected: { companyId: string; actorId: string; jobId: string }
  input: { operation_id: string; kind: 'upsert' | 'delete' } | null
}
type Report = {
  runtime: string; realCapabilityEvaluator: boolean; concurrentSessions: boolean
  count: number; checks: string[]; cleanup_assertions: number; fixtures: string
  contractCases: number; contracts: Contract[]; errors: { code: string; message: string; details: string }[]
}
const names = [
  'empty workspace', 'root upsert receipt', 'receipt lookup', 'populated workspace', 'child workspace',
  'cancel after applied receipt', 'terminal cancellation', 'late mutate after cancellation', 'cancelled delete', 'expired licence cancellation',
  'child upsert receipt', 'fixed receipt preserving hours', 'delete receipt replay', 'expired licence historical receipt',
]

// Runs the real migration with the mandatory pinned PostgreSQL runtime on every ordinary CI run.
// No hosted network access, conditional skip, provider mock or override of the migration implementation.
describe('actual atomic assignment batch SQL and production DTO contract', () => {
  let report: Report
  beforeAll(() => {
    report = JSON.parse(execFileSync(process.execPath, [path.resolve('scripts/test-job-assignment-batch-sql.mjs'), '--contract-json'], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 5 * 1024 * 1024, env: process.env,
    })) as Report
    expect(report).toMatchObject({ runtime: 'PGlite 0.5.9', realCapabilityEvaluator: true,
      concurrentSessions: false, fixtures: 'rolled_back', cleanup_assertions: 6, contractCases: names.length })
    expect(report.count).toBeGreaterThanOrEqual(73)
    expect(new Set(report.checks).size).toBe(report.count)
    expect(report.contracts.map(row => row.name).sort()).toEqual([...names].sort())
  }, 65_000)

  it.each(names)('parses an unmodified real database result: %s', name => {
    const c = report.contracts.find(row => row.name === name)!
    const scope = { companyId: c.expected.companyId, actorProfileId: c.expected.actorId, jobId: c.expected.jobId }
    const parsed = c.kind === 'workspace' ? parseAssignmentBatchWorkspace(c.data, scope)
      : (c.kind === 'outcome' ? parseAssignmentBatchOutcome : parseAssignmentBatchReceipt)(c.data, { ...scope, operationId: c.input!.operation_id, kind: c.input!.kind })
    expect(parsed.company_id).toBe(scope.companyId)
    expect(parsed.actor_id).toBe(scope.actorProfileId)
    expect(parsed.job_id).toBe(scope.jobId)
  })
  it('proves actual rollback after earlier row writes and preserves protected history', () => {
    expect(report.checks).toEqual(expect.arrayContaining([
      'multiworker_root_child_commit', 'injected_error_after_first_write', 'injected_error_rolls_back_all_workers_and_children',
      'injected_error_creates_no_receipt', 'protected_later_row_rejected_with_exact_source', 'protected_row_rolls_back_prior_workers',
      'protected_failure_creates_no_receipt', 'protected_child_blocks_entire_delete',
    ]))
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'P0001', message: 'BATCH_FIXTURE_FAILURE' })]))
    const protectedError = report.errors.find(row => row.message === 'LABOR_APPROVED_SOURCE_IMMUTABLE')!
    expect(protectedError.code).toBe('PT409')
    expect(JSON.parse(protectedError.details)).toMatchObject({ assignment_id: expect.any(String), profile_id: expect.any(String), job_id: expect.any(String) })
  })
  it('proves numeric validation, exact scoping, actor authority and stable retry behavior', () => {
    expect(report.checks).toEqual(expect.arrayContaining([
      'invalid_labor_hours_all_types_before_writes', 'invalid_hourly_rate_all_types_before_writes',
      'validation_failures_leave_all_rows_unchanged', 'invalid_scope_token_rejected', 'invalid_unknown_key_rejected', 'invalid_duplicate_worker_rejected', 'invalid_row_unknown_key_rejected', 'invalid_empty_rows_rejected', 'explicit_zero_preserved', 'fixed_optional_hours_and_rate_preserved',
      'invoice_insert_uses_legacy_nonnull_defaults', 'fixed_invoice_required_amount_validation',
      'child_scope_excludes_parent_and_sibling', 'child_write_excludes_parent_and_sibling', 'workspace_token_stable_across_session_timezones', 'child_row_change_invalidates_root_scope', 'new_child_invalidates_root_scope',
      'mismatched_source_id_denied', 'actor_pin_denied', 'foreign_job_denied', 'foreign_worker_denied', 'inactive_worker_denied',
      'role_manager_workspace_and_receipt_denied', 'role_worker_workspace_and_receipt_denied', 'role_accountant_workspace_and_receipt_denied',
      'foreign_actor_denied', 'anonymous_rpc_denied', 'other_admin_cannot_claim_actor_receipt',
      'same_operation_exact_replay', 'same_operation_changed_payload_conflict', 'stale_scope_rejected',
      'delete_root_child_worker_once', 'deleted_source_replay_and_lookup', 'receipt_storage_not_client_accessible', 'foreign_company_unchanged',
    ]))
    expect(report.errors.filter(row => row.code === 'PT409').map(row => row.message)).toEqual(expect.arrayContaining([
      'JOB_ASSIGNMENT_OPERATION_CONFLICT', 'JOB_ASSIGNMENT_SCOPE_CONFLICT', 'LABOR_APPROVED_SOURCE_IMMUTABLE',
    ]))
  })
  it('resolves both serial operation orders with permanent actor-bound cancellation markers', () => {
    expect(report.checks).toEqual(expect.arrayContaining([
      'applied_before_cancel_returns_applied_without_effect', 'cancel_before_mutate_creates_terminal_marker',
      'cancel_exact_replay_and_lookup', 'late_mutate_after_cancel_no_assignment_effect',
      'cancelled_operation_payload_change_conflicts_for_both_commands', 'cancel_actor_pin_denied', 'cancel_foreign_company_denied',
      'other_admin_cannot_cancel_original_actor_operation', 'deleted_job_cancellation_prevents_late_write',
      'role_manager_cancel_denied', 'role_worker_cancel_denied', 'role_accountant_cancel_denied',
      'foreign_actor_cancel_denied', 'anonymous_cancel_rpc_denied', 'cancelled_delete_preserves_root_and_children',
      'expired_licence_cancel_and_lookup_allowed', 'expired_licence_cancel_blocks_late_business_write',
      'expired_licence_cancel_returns_existing_applied_receipt', 'revoked_actor_cannot_cancel_operation',
    ]))
    expect(report.contracts.find(row => row.name === 'cancel after applied receipt')!.data)
      .toEqual(report.contracts.find(row => row.name === 'root upsert receipt')!.data)
    expect(report.contracts.find(row => row.name === 'terminal cancellation')!.data)
      .toEqual(report.contracts.find(row => row.name === 'late mutate after cancellation')!.data)
    for (const name of ['terminal cancellation', 'late mutate after cancellation', 'cancelled delete', 'expired licence cancellation']) {
      expect(report.contracts.find(row => row.name === name)!.data).toMatchObject({ cancelled: true })
    }
  })
  it('retains the original receipt after expiry without granting new write authority', () => {
    expect(report.checks).toEqual(expect.arrayContaining([
      'active_test_grant_allows_atomic_write', 'disabled_module_blocks_new_write_retains_receipt', 'expired_licence_retains_receipt_lookup', 'expired_licence_exact_replay_no_new_effect',
      'expired_licence_denies_new_write', 'revoked_actor_denied_historical_receipt',
    ]))
    expect(report.contracts.find(row => row.name === 'expired licence historical receipt')!.data)
      .toEqual(report.contracts.find(row => row.name === 'root upsert receipt')!.data)
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: '42501', message: 'JOB_ASSIGNMENT_MODULE_REQUIRED' })]))
  })
})
