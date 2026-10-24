import {
  parseAssignmentBatchCommand, parseAssignmentBatchReceipt, parseAssignmentBatchWorkspace,
  type AssignmentBatchCommand, type AssignmentBatchScope, type AssignmentBatchReceipt,
} from '@/lib/job-assignment-batch'

export { parseAssignmentBatchWorkspace as parseAssignmentWorkspace }
export type AssignmentScope = AssignmentBatchScope
export type AssignmentCommand = { method: 'POST' | 'PUT' | 'DELETE'; command: AssignmentBatchCommand }
export type { AssignmentBatchWorkspace as AssignmentWorkspace, AssignmentBatchReceipt as AssignmentReceipt } from '@/lib/job-assignment-batch'

export function makeAssignmentCommand(scope: AssignmentScope, scopeToken: string, operationId: string,
  method: AssignmentCommand['method'], payload: Record<string, unknown>): AssignmentCommand {
  const command = parseAssignmentBatchCommand({ ...scope, scopeToken, operationId,
    ...(method === 'DELETE' ? { kind: 'delete', assignmentId: payload.assignmentId }
      : { kind: 'upsert', assignments: method === 'POST' ? [payload] : payload.assignments }) })
  return { method, command }
}
export function parseStoredAssignmentCommand(raw: unknown, scope: AssignmentScope): AssignmentCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid command')
  const value = raw as AssignmentCommand
  if (!['POST', 'PUT', 'DELETE'].includes(value.method)) throw Error('Invalid method')
  const command = parseAssignmentBatchCommand(value.command)
  if (command.companyId !== scope.companyId || command.actorProfileId !== scope.actorProfileId || command.jobId !== scope.jobId
    || (value.method === 'DELETE') !== (command.kind === 'delete')
    || (value.method === 'POST' && command.kind === 'upsert' && (command.assignments.length !== 1 || command.assignments[0].id))) throw Error('Foreign command')
  // Persist only canonical commands. Do not silently alter the payload of an uncertain operation.
  const canonical = { method: value.method, command }
  if (JSON.stringify(canonical) !== JSON.stringify(raw)) throw Error('Altered command')
  return canonical
}
export function assignmentCommandBody({ method, command }: AssignmentCommand): Record<string, unknown> {
  const pins = { companyId: command.companyId, actorProfileId: command.actorProfileId,
    operationId: command.operationId, scopeToken: command.scopeToken }
  return { ...pins, ...(command.kind === 'delete' ? { assignmentId: command.assignmentId }
    : method === 'POST' ? command.assignments[0] : { assignments: command.assignments }) }
}
export function parseAssignmentReceipt(raw: unknown, scope: AssignmentScope, stored: AssignmentCommand): AssignmentBatchReceipt {
  const command = stored.command
  const receipt = parseAssignmentBatchReceipt(raw, { ...scope, operationId: command.operationId, kind: command.kind })
  if (command.kind === 'delete') {
    if (!receipt.deleted_ids.includes(command.assignmentId)) throw Error('Missing deleted row')
  } else {
    for (const input of command.assignments) {
      const row = receipt.assignments.find(row => row.profile_id === input.profile_id && (!input.id || row.id === input.id))
      if (!row) throw Error('Missing saved row')
      for (const field of ['labor_hours', 'hourly_rate', 'external_amount', 'worker_type_snapshot', 'assignment_billing_type', 'note'] as const) {
        if (input[field] !== undefined && row[field] !== input[field]) throw Error('Unconfirmed value')
      }
    }
  }
  return receipt
}
export function assignmentOperationStorageKey(scope: AssignmentScope): string {
  return `diriqo:assignment-operation:v1:${scope.companyId}:${scope.actorProfileId}:${scope.jobId}`
}
