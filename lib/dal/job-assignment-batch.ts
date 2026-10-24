import 'server-only'
import type { DalContext } from '@/lib/dal/auth'
import { AssignmentBatchError, assignmentBatchPayload, parseAssignmentBatchCommand, parseAssignmentBatchWorkspace, parseAssignmentBatchOutcome, type AssignmentBatchCommand, type AssignmentBatchScope } from '@/lib/job-assignment-batch'
import { approvedLaborSourceCode, laborSourceReviewHref } from '@/lib/labor-source-navigation'
import { laborHistoryId } from '@/lib/labor-history'

function checkScope(ctx: DalContext, scope: AssignmentBatchScope) {
  if (!['company_admin','super_admin'].includes(ctx.role ?? '') || ctx.companyId !== scope.companyId || ctx.profileId !== scope.actorProfileId) {
    throw new AssignmentBatchError('Firma nebo přihlášený účet se změnil. Otevřete záznam znovu.', 'forbidden')
  }
}
export function assignmentBatchRpcError(error: unknown, scope: AssignmentBatchScope): AssignmentBatchError {
  if (error instanceof AssignmentBatchError) return error
  const e = error && typeof error === 'object' ? error as {message?: unknown;code?:unknown;details?:unknown} : {}
  if (e.message === approvedLaborSourceCode) {
    let href = `/labor?${new URLSearchParams({company:scope.companyId,actor:scope.actorProfileId})}`
    try {
      const detail = typeof e.details === 'string' ? JSON.parse(e.details) : null
      href = laborSourceReviewHref({companyId:scope.companyId,actorProfileId:scope.actorProfileId,
        jobId:laborHistoryId(detail.job_id),profileId:laborHistoryId(detail.profile_id),source:{kind:'assignment',id:laborHistoryId(detail.assignment_id)}})
    } catch { /* Never invent a source when PostgreSQL cannot identify the protected row. */ }
    return new AssignmentBatchError('Schválenou práci nelze přepsat ani odstranit. Ve výkazu vytvořte opravu ke schválení.', 'protected', false, href)
  }
  if (e.message === 'JOB_ASSIGNMENT_INVALID' || e.code === '22023' || e.code === '22P02') return new AssignmentBatchError('Neplatné údaje přiřazení.', 'validation')
  if (['JOB_ASSIGNMENT_FORBIDDEN','JOB_ASSIGNMENT_ACTOR_CHANGED','JOB_ASSIGNMENT_MODULE_REQUIRED','JOB_ASSIGNMENT_NOT_FOUND'].includes(String(e.message)) || e.code === '42501') {
    return new AssignmentBatchError('Zápis není v aktivní firmě dostupný. Ověřte účet, oprávnění a licenci.', 'forbidden')
  }
  if (['JOB_ASSIGNMENT_SCOPE_CONFLICT','JOB_ASSIGNMENT_OPERATION_CONFLICT'].includes(String(e.message))) {
    return new AssignmentBatchError('Přiřazení nebo rozsah zakázky se změnil. Načtěte aktuální údaje a zkontrolujte rozepsanou změnu.', 'conflict')
  }
  if (e.code === 'PGRST202' || e.code === '42883') return new AssignmentBatchError('Hromadné ukládání zatím není dostupné.', 'unavailable')
  return new AssignmentBatchError('Výsledek zápisu není potvrzený. Nejdříve ověřte původní operaci.', 'unknown')
}
export async function getAssignmentBatchWorkspace(ctx: DalContext, scope: AssignmentBatchScope) {
  checkScope(ctx,scope)
  try {
    const {data,error} = await ctx.supabase.rpc('get_job_assignment_batch_workspace', {target_company_id:scope.companyId,target_job_id:scope.jobId})
    if (error) throw error
    return parseAssignmentBatchWorkspace(data,scope)
  } catch(error) { throw assignmentBatchRpcError(error,scope) }
}
export async function getAssignmentBatchReceipt(ctx: DalContext, scope: AssignmentBatchScope, operationId: string) {
  checkScope(ctx,scope)
  try {
    const {data,error} = await ctx.supabase.rpc('get_job_assignment_batch_receipt', {target_company_id:scope.companyId,target_job_id:scope.jobId,target_operation_id:laborHistoryId(operationId)})
    if (error) throw error
    return data === null ? null : parseAssignmentBatchOutcome(data,{...scope,operationId})
  } catch(error) { throw assignmentBatchRpcError(error,scope) }
}
export async function mutateAssignmentBatch(ctx: DalContext, input: AssignmentBatchCommand) {
  const command = parseAssignmentBatchCommand(input)
  checkScope(ctx,command)
  try {
    const {data,error} = await ctx.supabase.rpc('mutate_job_assignments_atomic', {target_company_id:command.companyId,target_job_id:command.jobId,payload:assignmentBatchPayload(command)})
    if (error) throw error
    return parseAssignmentBatchOutcome(data,command)
  } catch(error) { throw assignmentBatchRpcError(error,command) }
}

export async function cancelAssignmentBatch(ctx: DalContext, input: AssignmentBatchCommand) {
  const command = parseAssignmentBatchCommand(input)
  checkScope(ctx,command)
  try {
    const {data,error} = await ctx.supabase.rpc('cancel_job_assignment_batch_operation', {target_company_id:command.companyId,target_job_id:command.jobId,payload:assignmentBatchPayload(command)})
    if (error) throw error
    return parseAssignmentBatchOutcome(data,command)
  } catch(error) { throw assignmentBatchRpcError(error,command) }
}
