import { laborHistoryId } from '@/lib/labor-history'

export const ASSIGNMENT_BATCH_LIMITS = { workers: 200, jobs: 1000, rows: 20000, note: 4000, bytes: 1024 * 1024 } as const
export type AssignmentBatchCode = 'validation' | 'forbidden' | 'conflict' | 'protected' | 'unavailable' | 'unknown'
export class AssignmentBatchError extends Error {
  constructor(message: string, readonly code: AssignmentBatchCode, readonly uncertain = code === 'unknown', readonly reviewHref?: string) {
    super(message); this.name = 'AssignmentBatchError'
  }
}
export type AssignmentBatchScope = { companyId: string; actorProfileId: string; jobId: string }
export type AssignmentBatchInputRow = {
  id?: string; profile_id: string; labor_hours?: number; hourly_rate?: number
  worker_type_snapshot: 'employee' | 'contractor'; assignment_billing_type: 'hourly' | 'fixed' | 'invoice' | null
  external_amount: number | null; note: string | null
}
export type AssignmentBatchCommand = AssignmentBatchScope & { operationId: string; scopeToken: string } & (
  { kind: 'upsert'; assignments: AssignmentBatchInputRow[] } | { kind: 'delete'; assignmentId: string }
)
export type AssignmentBatchRow = {
  id: string; company_id: string; job_id: string; profile_id: string; labor_hours: number; hourly_rate: number
  worker_type_snapshot: 'employee' | 'contractor' | null; assignment_billing_type: 'hourly' | 'fixed' | 'invoice' | null
  external_amount: number | null; note: string | null; work_started_at: string | null; work_completed_at: string | null; archived_at: string | null
}
export type AssignmentBatchWorkspace = {
  company_id: string; actor_id: string; job_id: string; scope_token: string; target_job_ids: string[]; assignments: AssignmentBatchRow[]
}
export type AssignmentBatchReceipt = AssignmentBatchWorkspace & { operation_id: string; kind: 'upsert' | 'delete'; deleted_ids: string[] }
export type AssignmentBatchCancellation = { company_id: string; actor_id: string; job_id: string; operation_id: string; kind: 'upsert' | 'delete'; cancelled: true }
export type AssignmentBatchOutcome = AssignmentBatchReceipt | AssignmentBatchCancellation

function invalid(): never { throw new AssignmentBatchError('Neplatné údaje přiřazení.', 'validation') }
function unreadable(): never { throw new AssignmentBatchError('Výsledek operace se nepodařilo ověřit. Před dalším zápisem ověřte původní operaci.', 'unknown') }
function record(value: unknown, fail: () => never): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function id(value: unknown, fail: () => never): string { try { return laborHistoryId(value).toLowerCase() } catch { return fail() } }
function token(value: unknown, fail: () => never): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail()
  return value
}
function inputNumber(value: unknown, required: boolean): number | undefined {
  if (value == null) { if (required) invalid(); return undefined }
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) invalid()
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 9999999999.99) invalid()
  return n
}
export function normalizeAssignmentBatchRow(value: unknown): AssignmentBatchInputRow {
  const r = record(value, invalid), worker = r.worker_type_snapshot ?? 'employee'
  if (worker !== 'employee' && worker !== 'contractor') invalid()
  const billing = worker === 'contractor' ? r.assignment_billing_type : null
  if (worker === 'contractor' && !['hourly','fixed','invoice'].includes(billing as string)) invalid()
  const hourly = worker === 'employee' || billing === 'hourly'
  const hours = inputNumber(r.labor_hours, hourly), rate = inputNumber(r.hourly_rate, hourly)
  const external = inputNumber(r.external_amount, !hourly)
  if (r.note != null && (typeof r.note !== 'string' || r.note.length > ASSIGNMENT_BATCH_LIMITS.note)) invalid()
  return { ...(r.id === undefined ? {} : { id: id(r.id, invalid) }), profile_id: id(r.profile_id, invalid),
    ...(hours === undefined ? {} : { labor_hours: hours }), ...(rate === undefined ? {} : { hourly_rate: rate }),
    worker_type_snapshot: worker, assignment_billing_type: billing as AssignmentBatchInputRow['assignment_billing_type'],
    external_amount: hourly ? null : external!, note: typeof r.note === 'string' ? r.note.trim() || null : null }
}
export function parseAssignmentBatchCommand(value: unknown): AssignmentBatchCommand {
  const r = record(value, invalid)
  const scope = { companyId: id(r.companyId, invalid), actorProfileId: id(r.actorProfileId, invalid), jobId: id(r.jobId, invalid),
    operationId: id(r.operationId, invalid), scopeToken: token(r.scopeToken, invalid) }
  if (r.kind === 'delete') return { ...scope, kind: 'delete', assignmentId: id(r.assignmentId, invalid) }
  if (r.kind !== 'upsert' || !Array.isArray(r.assignments) || !r.assignments.length || r.assignments.length > ASSIGNMENT_BATCH_LIMITS.workers) invalid()
  const assignments = r.assignments.map(normalizeAssignmentBatchRow)
  if (new Set(assignments.map(row => row.profile_id)).size !== assignments.length) invalid()
  return { ...scope, kind: 'upsert', assignments }
}
export function assignmentBatchPayload(command: AssignmentBatchCommand) {
  return { actor_id: command.actorProfileId, operation_id: command.operationId, scope_token: command.scopeToken, kind: command.kind,
    ...(command.kind === 'upsert' ? { assignments: command.assignments } : { assignment_id: command.assignmentId }) }
}
function readNumber(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^-?\d+(?:\.\d+)?$/.test(String(value))) unreadable()
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) > 9999999999.99) unreadable()
  return n
}
function readDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) unreadable()
  return value
}
function readRow(value: unknown, companyId: string, jobs: string[]): AssignmentBatchRow {
  const r = record(value, unreadable)
  const company = id(r.company_id, unreadable), job = id(r.job_id, unreadable)
  if (company !== companyId || !jobs.includes(job)) unreadable()
  if (r.worker_type_snapshot !== null && !['employee','contractor'].includes(r.worker_type_snapshot as string)) unreadable()
  if (r.assignment_billing_type !== null && !['hourly','fixed','invoice'].includes(r.assignment_billing_type as string)) unreadable()
  if (r.note !== null && typeof r.note !== 'string') unreadable()
  return { id: id(r.id, unreadable), company_id: company, job_id: job, profile_id: id(r.profile_id, unreadable),
    labor_hours: readNumber(r.labor_hours), hourly_rate: readNumber(r.hourly_rate), external_amount: r.external_amount === null ? null : readNumber(r.external_amount),
    worker_type_snapshot: r.worker_type_snapshot as AssignmentBatchRow['worker_type_snapshot'], assignment_billing_type: r.assignment_billing_type as AssignmentBatchRow['assignment_billing_type'],
    note: r.note as string | null, work_started_at: readDate(r.work_started_at), work_completed_at: readDate(r.work_completed_at), archived_at: readDate(r.archived_at) }
}
export function parseAssignmentBatchWorkspace(value: unknown, scope: AssignmentBatchScope): AssignmentBatchWorkspace {
  const r = record(value, unreadable)
  if (id(r.company_id, unreadable) !== scope.companyId || id(r.actor_id, unreadable) !== scope.actorProfileId || id(r.job_id, unreadable) !== scope.jobId) unreadable()
  if (!Array.isArray(r.target_job_ids) || !r.target_job_ids.length || r.target_job_ids.length > ASSIGNMENT_BATCH_LIMITS.jobs) unreadable()
  const jobs = r.target_job_ids.map(value => id(value, unreadable))
  if (!jobs.includes(scope.jobId) || new Set(jobs).size !== jobs.length) unreadable()
  if (!Array.isArray(r.assignments) || r.assignments.length > ASSIGNMENT_BATCH_LIMITS.rows) unreadable()
  const assignments = r.assignments.map(row => readRow(row, scope.companyId, jobs))
  if (new Set(assignments.map(row => row.id)).size !== assignments.length
    || new Set(assignments.map(row => row.job_id + ':' + row.profile_id)).size !== assignments.length) unreadable()
  return { company_id: scope.companyId, actor_id: scope.actorProfileId, job_id: scope.jobId, scope_token: token(r.scope_token, unreadable), target_job_ids: jobs, assignments }
}
export function parseAssignmentBatchReceipt(value: unknown, scope: AssignmentBatchScope & { operationId?: string; kind?: 'upsert' | 'delete' }): AssignmentBatchReceipt {
  const r = record(value, unreadable), workspace = parseAssignmentBatchWorkspace(value, scope)
  if (r.cancelled !== undefined && r.cancelled !== false) unreadable()
  const operationId = id(r.operation_id, unreadable)
  if ((scope.operationId !== undefined && operationId !== scope.operationId) || (scope.kind !== undefined && r.kind !== scope.kind) || !['upsert','delete'].includes(r.kind as string)) unreadable()
  if (workspace.assignments.some(row => row.job_id !== scope.jobId) || !Array.isArray(r.deleted_ids) || r.deleted_ids.length > ASSIGNMENT_BATCH_LIMITS.rows) unreadable()
  const deleted = r.deleted_ids.map(value => id(value, unreadable))
  if (new Set(deleted).size !== deleted.length || deleted.some(value => workspace.assignments.some(row => row.id === value))
    || (r.kind === 'upsert' && deleted.length !== 0)) unreadable()
  return { ...workspace, operation_id: operationId, kind: r.kind as AssignmentBatchReceipt['kind'], deleted_ids: deleted }
}

/** A terminal cancellation is a database receipt, never an empty or missing successful result. */
export function parseAssignmentBatchOutcome(value: unknown, scope: AssignmentBatchScope & { operationId?: string; kind?: 'upsert' | 'delete' }): AssignmentBatchOutcome {
  const r = record(value, unreadable)
  if (r.cancelled !== true) return parseAssignmentBatchReceipt(value, scope)
  if (Object.keys(r).some(key => !['company_id','actor_id','job_id','operation_id','kind','cancelled'].includes(key))) unreadable()
  if (id(r.company_id, unreadable) !== scope.companyId || id(r.actor_id, unreadable) !== scope.actorProfileId || id(r.job_id, unreadable) !== scope.jobId) unreadable()
  const operationId = id(r.operation_id, unreadable)
  if ((scope.operationId !== undefined && operationId !== scope.operationId) || (scope.kind !== undefined && r.kind !== scope.kind) || !['upsert','delete'].includes(r.kind as string)) unreadable()
  return {company_id:scope.companyId,actor_id:scope.actorProfileId,job_id:scope.jobId,operation_id:operationId,kind:r.kind as 'upsert' | 'delete',cancelled:true}
}
